import { GoogleSignin } from "@react-native-google-signin/google-signin";
// The new expo-file-system API has no uploader, so the archive upload is the one place we
// reach for the legacy module (see CLAUDE.md). `uploadAsync` streams the file from native,
// which is what keeps a multi-hundred-MB photo archive off the JS heap.
import { FileSystemUploadType, uploadAsync } from "expo-file-system/legacy";

import { BACKUP } from "../../constants/backup";

/**
 * Google Drive upload for cloud backup.
 *
 * We use the incremental `drive.file` scope — the app can only ever see files it
 * created itself, so enabling backup never exposes the user's wider Drive. The scope
 * is requested lazily (only when the user turns backup on / runs a backup), keeping
 * the normal sign-in prompt minimal.
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
