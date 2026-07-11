import { GoogleSignin } from "@react-native-google-signin/google-signin";
// The new expo-file-system API has no uploader, so the archive upload is the one place we
// reach for the legacy module (see CLAUDE.md). `uploadAsync` streams the file from native,
// which is what keeps a multi-hundred-MB photo archive off the JS heap.
import { downloadAsync, FileSystemUploadType, uploadAsync } from "expo-file-system/legacy";

import { BACKUP } from "../../constants/backup";

/**
 * Google Drive upload + download for cloud backup and restore.
 *
 * We use the incremental `drive.file` scope — the app can only ever see files it
 * created itself, so enabling backup never exposes the user's wider Drive. The scope
 * is requested lazily (only when the user turns backup on / runs a backup / restores),
 * keeping the normal sign-in prompt minimal. This is also why restore cannot silently
 * check for a backup before asking: without the scope there is nothing to search.
 *
 * Retention is keep-only-latest: a single Drive file (`driveFileId`) is overwritten on
 * every backup. If that file was deleted from Drive, the upload transparently recreates it.
 *
 * The archive is uploaded **from a file on disk, never as a `Blob` or a typed array**.
 * React Native's `Blob` cannot be constructed from an `ArrayBuffer`/`ArrayBufferView` (it
 * throws "Creating blobs from 'ArrayBuffer' and 'ArrayBufferView' are not supported"), and
 * handing `fetch` a `Uint8Array` instead makes RN base64-encode the whole payload in JS —
 * several copies of the archive in memory. Both are dead ends for a photo-sized backup.
 */

/**
 * Raised when Drive can't be reached and the user should retry / re-sign-in.
 *
 * `retryable` says whether repeating the same call unattended could succeed: a network
 * blip, an expired token or a 5xx will, whereas a missing Google session or a declined
 * Drive consent needs the user, so an automatic retry would only spin. See
 * `isRetryableBackupError` in ./backupService.
 */
export class DriveAccessError extends Error {
    constructor(
        message: string,
        readonly retryable: boolean,
    ) {
        super(message);
        this.name = "DriveAccessError";
    }
}

/** The signed-in Google account's email, for backup provenance. Null when not signed in. */
export const getCurrentAccountEmail = (): string | null =>
    GoogleSignin.getCurrentUser()?.user?.email ?? null;

/**
 * HTTP statuses worth retrying unattended: rate limits, timeouts, server-side faults, and
 * 401 (each backup fetches a fresh access token, so an expired one self-heals). A 403
 * (permission revoked) or 400 will not fix itself.
 */
const isTransientStatus = (status: number): boolean =>
    status === 401 || status === 408 || status === 429 || status >= 500;

/**
 * Obtain a Google OAuth access token that carries the Drive scope. Restores the native
 * Google session (which can be absent after a restart even when the Supabase session
 * persists) and requests the `drive.file` scope on first use.
 */
export const ensureDriveAccessTokenAsync = async (): Promise<string> => {
    // Restore the cached native Google session if the app was restarted. Best-effort:
    // getCurrentUser() below is the real gate.
    try {
        await GoogleSignin.signInSilently();
    } catch {
        // No cached session — fall through to the explicit check.
    }

    const current = GoogleSignin.getCurrentUser();
    if (!current) {
        throw new DriveAccessError(
            "Please sign in with Google again to enable cloud backup.",
            false,
        );
    }

    // Request the Drive scope if it wasn't granted yet (interactive consent, once).
    if (!current.scopes?.includes(BACKUP.driveScope)) {
        try {
            await GoogleSignin.addScopes({ scopes: [BACKUP.driveScope] });
        } catch {
            throw new DriveAccessError(
                "Google Drive permission is required for cloud backup.",
                false,
            );
        }
    }

    try {
        const { accessToken } = await GoogleSignin.getTokens();
        return accessToken;
    } catch {
        throw new DriveAccessError("Couldn't get Google Drive access. Please try again.", true);
    }
};

/** Stream `fileUri` into the media body of an existing Drive file. */
const uploadMediaAsync = async (
    accessToken: string,
    fileId: string,
    fileUri: string,
): Promise<void> => {
    const res = await uploadAsync(
        `https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=media`,
        fileUri,
        {
            httpMethod: "PATCH",
            uploadType: FileSystemUploadType.BINARY_CONTENT,
            headers: {
                Authorization: `Bearer ${accessToken}`,
                "Content-Type": BACKUP.driveMimeType,
            },
        },
    );
    // uploadAsync resolves for any completed request, so the status is ours to check.
    if (res.status < 200 || res.status > 299) {
        throw new DriveAccessError(
            `Drive upload failed (${res.status}).`,
            isTransientStatus(res.status),
        );
    }
};

const createFileAsync = async (accessToken: string): Promise<string> => {
    const res = await fetch("https://www.googleapis.com/drive/v3/files", {
        method: "POST",
        headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            name: BACKUP.driveFileName,
            mimeType: BACKUP.driveMimeType,
        }),
    });
    if (!res.ok) {
        throw new DriveAccessError(
            `Couldn't create the Drive backup file (${res.status}).`,
            isTransientStatus(res.status),
        );
    }
    const json = (await res.json()) as { id?: string };
    if (!json.id) throw new DriveAccessError("Drive did not return a file id.", true);
    return json.id;
};

/**
 * Upload the archive at `fileUri` as the single latest backup, overwriting the file
 * identified by `existingFileId` when possible. Returns the id of the file that now holds
 * the backup (persist it for the next run). Recreates the file if the stored id is gone (404).
 */
export const uploadLatestBackupAsync = async (
    accessToken: string,
    fileUri: string,
    existingFileId: string | null,
): Promise<string> => {
    if (existingFileId) {
        try {
            await uploadMediaAsync(accessToken, existingFileId, fileUri);
            return existingFileId;
        } catch {
            // The stored file may have been deleted/renamed on Drive — fall through and
            // recreate it once so keep-latest self-heals instead of failing permanently.
        }
    }

    const fileId = await createFileAsync(accessToken);
    await uploadMediaAsync(accessToken, fileId, fileUri);
    return fileId;
};

// ---------------------------------------------------------------------------
// Restore
// ---------------------------------------------------------------------------

export type DriveBackupFile = {
    id: string;
    /** Bytes, or null when Drive omitted the field. */
    size: number | null;
    /** RFC-3339 timestamp of the last upload, or null. */
    modifiedTime: string | null;
};

const encodeQuery = (params: Record<string, string>): string =>
    Object.entries(params)
        .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
        .join("&");

/**
 * Find the most recent backup this app uploaded, or null when there is none.
 *
 * The `drive.file` scope makes this search safe by construction: `files.list` can only ever
 * return files the app created itself, so we never see — or need permission for — the rest of
 * the user's Drive. That grant is keyed to the OAuth client rather than to the install, which
 * is what lets a reinstall (or a brand-new device) still find the archive an earlier one wrote.
 *
 * Backups are keep-only-latest, so there is normally exactly one match. We still sort newest
 * first, because a Drive file deleted mid-backup makes the app recreate it (see
 * `uploadLatestBackupAsync`) and a trashed-but-not-purged original can linger under the name.
 */
export const findLatestBackupAsync = async (
    accessToken: string,
): Promise<DriveBackupFile | null> => {
    const query = encodeQuery({
        q: `name = '${BACKUP.driveFileName}' and trashed = false`,
        orderBy: "modifiedTime desc",
        pageSize: "1",
        fields: "files(id,size,modifiedTime)",
        spaces: "drive",
    });

    let res: Response;
    try {
        res = await fetch(`https://www.googleapis.com/drive/v3/files?${query}`, {
            headers: { Authorization: `Bearer ${accessToken}` },
        });
    } catch {
        throw new DriveAccessError("Couldn't reach Google Drive. Check your connection.", true);
    }

    if (!res.ok) {
        throw new DriveAccessError(
            `Couldn't search Google Drive (${res.status}).`,
            isTransientStatus(res.status),
        );
    }

    const json = (await res.json()) as {
        files?: { id?: string; size?: string; modifiedTime?: string }[];
    };
    const file = json.files?.[0];
    if (!file?.id) return null;

    // Drive reports `size` as a decimal string, and omits it entirely for some file types.
    const size = file.size != null ? Number.parseInt(file.size, 10) : NaN;

    return {
        id: file.id,
        size: Number.isFinite(size) ? size : null,
        modifiedTime: file.modifiedTime ?? null,
    };
};

/**
 * Stream the Drive file's media body into `destUri` (a `file://` path in the cache dir).
 *
 * Downloading to disk rather than through `fetch().arrayBuffer()` mirrors the upload path:
 * a photo archive is far too large to hold an extra copy of on the JS heap.
 */
export const downloadBackupAsync = async (
    accessToken: string,
    fileId: string,
    destUri: string,
): Promise<void> => {
    let res: Awaited<ReturnType<typeof downloadAsync>>;
    try {
        res = await downloadAsync(
            `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`,
            destUri,
            { headers: { Authorization: `Bearer ${accessToken}` } },
        );
    } catch {
        throw new DriveAccessError("The backup download failed. Please try again.", true);
    }

    // downloadAsync resolves for any completed request, so the status is ours to check.
    if (res.status < 200 || res.status > 299) {
        throw new DriveAccessError(
            `Couldn't download the backup (${res.status}).`,
            isTransientStatus(res.status),
        );
    }
};
