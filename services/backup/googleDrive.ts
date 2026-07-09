import { GoogleSignin } from "@react-native-google-signin/google-signin";

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
 */

/** Raised when Drive can't be reached and the user should retry / re-sign-in. */
export class DriveAccessError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "DriveAccessError";
    }
}

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
        );
    }

    // Request the Drive scope if it wasn't granted yet (interactive consent, once).
    if (!current.scopes?.includes(BACKUP.driveScope)) {
        try {
            await GoogleSignin.addScopes({ scopes: [BACKUP.driveScope] });
        } catch {
            throw new DriveAccessError(
                "Google Drive permission is required for cloud backup.",
            );
        }
    }

    try {
        const { accessToken } = await GoogleSignin.getTokens();
        return accessToken;
    } catch {
        throw new DriveAccessError("Couldn't get Google Drive access. Please try again.");
    }
};

const uploadMediaAsync = async (
    accessToken: string,
    fileId: string,
    body: Blob,
): Promise<void> => {
    const res = await fetch(
        `https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=media`,
        {
            method: "PATCH",
            headers: {
                Authorization: `Bearer ${accessToken}`,
                "Content-Type": BACKUP.driveMimeType,
            },
            body,
        },
    );
    if (!res.ok) {
        throw new DriveAccessError(`Drive upload failed (${res.status}).`);
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
        throw new DriveAccessError(`Couldn't create the Drive backup file (${res.status}).`);
    }
    const json = (await res.json()) as { id?: string };
    if (!json.id) throw new DriveAccessError("Drive did not return a file id.");
    return json.id;
};

/**
 * Upload `bytes` as the single latest backup, overwriting the file identified by
 * `existingFileId` when possible. Returns the id of the file that now holds the backup
 * (persist it for the next run). Recreates the file if the stored id is gone (404).
 */
export const uploadLatestBackupAsync = async (
    accessToken: string,
    bytes: Uint8Array,
    existingFileId: string | null,
): Promise<string> => {
    // Cast: a Uint8Array is a valid BlobPart at runtime; the type error is only about the
    // ArrayBufferLike vs ArrayBuffer union under the current lib settings.
    const body = new Blob([bytes as unknown as BlobPart], { type: BACKUP.driveMimeType });

    if (existingFileId) {
        try {
            await uploadMediaAsync(accessToken, existingFileId, body);
            return existingFileId;
        } catch {
            // The stored file may have been deleted/renamed on Drive — fall through and
            // recreate it once so keep-latest self-heals instead of failing permanently.
        }
    }

    const fileId = await createFileAsync(accessToken);
    await uploadMediaAsync(accessToken, fileId, body);
    return fileId;
};
