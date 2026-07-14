import { GoogleSignin } from "@react-native-google-signin/google-signin";
// The new expo-file-system API has no uploader; `uploadAsync`/`downloadAsync` stream
// from/to disk natively, keeping photo payloads off the JS heap entirely.
import { downloadAsync, FileSystemUploadType, uploadAsync } from "expo-file-system/legacy";

import { SYNC } from "../../constants/sync";

/**
 * Thin Google Drive v3 REST client for the sync engine. Uses the incremental
 * `drive.file` scope — the app can only ever see files it created itself, so `files.list`
 * with no query *is* a complete listing of the remote dataset. The scope is requested
 * lazily (first sync), keeping the normal sign-in prompt minimal.
 */

/**
 * Raised when Drive can't be reached or access is gone. `retryable` says whether
 * repeating the call unattended could succeed: a network blip, an expired token or a
 * 5xx will; a missing Google session or declined consent needs the user.
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

/** The signed-in Google account's email, for provenance. Null when not signed in. */
export const getCurrentAccountEmail = (): string | null =>
    GoogleSignin.getCurrentUser()?.user?.email ?? null;

/**
 * HTTP statuses worth retrying unattended: rate limits, timeouts, server-side faults, and
 * 401 (each sync fetches a fresh access token, so an expired one self-heals).
 */
const isTransientStatus = (status: number): boolean =>
    status === 401 || status === 408 || status === 429 || status >= 500;

/**
 * Obtain a Google OAuth access token that carries the Drive scope. Restores the native
 * Google session (which can be absent after a restart even when the Supabase session
 * persists) and requests the `drive.file` scope on first use.
 */
export const ensureDriveAccessTokenAsync = async (): Promise<string> => {
    try {
        await GoogleSignin.signInSilently();
    } catch {
        // No cached session — fall through to the explicit check.
    }

    const current = GoogleSignin.getCurrentUser();
    if (!current) {
        throw new DriveAccessError("Please sign in with Google again to enable sync.", false);
    }

    if (!current.scopes?.includes(SYNC.driveScope)) {
        try {
            await GoogleSignin.addScopes({ scopes: [SYNC.driveScope] });
        } catch {
            throw new DriveAccessError("Google Drive permission is required for sync.", false);
        }
    }

    try {
        const { accessToken } = await GoogleSignin.getTokens();
        return accessToken;
    } catch {
        throw new DriveAccessError("Couldn't get Google Drive access. Please try again.", true);
    }
};

const driveFetchAsync = async (
    accessToken: string,
    path: string,
    init: RequestInit & { failMessage: string },
): Promise<Response> => {
    let res: Response;
    try {
        res = await fetch(`https://www.googleapis.com${path}`, {
            ...init,
            headers: {
                Authorization: `Bearer ${accessToken}`,
                ...(init.headers ?? {}),
            },
        });
    } catch {
        throw new DriveAccessError("Couldn't reach Google Drive. Check your connection.", true);
    }
    if (!res.ok) {
        throw new DriveAccessError(
            `${init.failMessage} (${res.status}).`,
            isTransientStatus(res.status),
        );
    }
    return res;
};

export type RemoteFile = {
    id: string;
    name: string;
    mimeType: string;
    parents: string[];
    md5Checksum: string | null;
    size: number | null;
    appProperties: Record<string, string> | null;
};

const FOLDER_MIME = "application/vnd.google-apps.folder";

export const isRemoteFolder = (file: RemoteFile): boolean => file.mimeType === FOLDER_MIME;

/**
 * Every not-trashed file this app can see (drive.file scope ⇒ exactly the app's own
 * files), paged at 1000/request. ~1 request per 1000 files.
 */
export const listAllFilesAsync = async (accessToken: string): Promise<RemoteFile[]> => {
    const files: RemoteFile[] = [];
    let pageToken: string | undefined;

    do {
        const params = new URLSearchParams({
            q: "trashed = false",
            pageSize: "1000",
            fields: "nextPageToken,files(id,name,mimeType,parents,md5Checksum,size,appProperties)",
            spaces: "drive",
        });
        if (pageToken) params.set("pageToken", pageToken);

        const res = await driveFetchAsync(accessToken, `/drive/v3/files?${params.toString()}`, {
            failMessage: "Couldn't list Google Drive files",
        });
        const json = (await res.json()) as {
            nextPageToken?: string;
            files?: {
                id: string;
                name: string;
                mimeType: string;
                parents?: string[];
                md5Checksum?: string;
                size?: string;
                appProperties?: Record<string, string>;
            }[];
        };

        for (const f of json.files ?? []) {
            const size = f.size != null ? Number.parseInt(f.size, 10) : NaN;
            files.push({
                id: f.id,
                name: f.name,
                mimeType: f.mimeType,
                parents: f.parents ?? [],
                md5Checksum: f.md5Checksum ?? null,
                size: Number.isFinite(size) ? size : null,
                appProperties: f.appProperties ?? null,
            });
        }
        pageToken = json.nextPageToken;
    } while (pageToken);

    return files;
};

export const createFolderAsync = async (
    accessToken: string,
    name: string,
    parentId: string | null,
    appProperties?: Record<string, string>,
): Promise<string> => {
    const res = await driveFetchAsync(accessToken, "/drive/v3/files", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            name,
            mimeType: FOLDER_MIME,
            ...(parentId ? { parents: [parentId] } : {}),
            ...(appProperties ? { appProperties } : {}),
        }),
        failMessage: "Couldn't create a Drive folder",
    });
    const json = (await res.json()) as { id?: string };
    if (!json.id) throw new DriveAccessError("Drive did not return a folder id.", true);
    return json.id;
};

/** Create a small text/JSON file in one multipart request. Returns the file id. */
export const createTextFileAsync = async (
    accessToken: string,
    name: string,
    parentId: string,
    content: string,
    mimeType = "application/json",
): Promise<string> => {
    const boundary = `derma${Date.now().toString(36)}`;
    const metadata = JSON.stringify({ name, parents: [parentId] });
    const body =
        `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n` +
        `--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n${content}\r\n--${boundary}--`;

    const res = await driveFetchAsync(
        accessToken,
        "/upload/drive/v3/files?uploadType=multipart&fields=id",
        {
            method: "POST",
            headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
            body,
            failMessage: "Couldn't upload to Google Drive",
        },
    );
    const json = (await res.json()) as { id?: string };
    if (!json.id) throw new DriveAccessError("Drive did not return a file id.", true);
    return json.id;
};

/**
 * Replace a small text/JSON file's content. Falls back to `null` ONLY on 404 (the file
 * was deleted remotely) so the caller can recreate it — any other failure throws.
 */
export const updateTextFileAsync = async (
    accessToken: string,
    fileId: string,
    content: string,
    mimeType = "application/json",
): Promise<string | null> => {
    let res: Response;
    try {
        res = await fetch(
            `https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=media`,
            {
                method: "PATCH",
                headers: {
                    Authorization: `Bearer ${accessToken}`,
                    "Content-Type": mimeType,
                },
                body: content,
            },
        );
    } catch {
        throw new DriveAccessError("Couldn't reach Google Drive. Check your connection.", true);
    }
    if (res.status === 404) return null;
    if (!res.ok) {
        throw new DriveAccessError(
            `Couldn't update a Drive file (${res.status}).`,
            isTransientStatus(res.status),
        );
    }
    return fileId;
};

/**
 * Upload a local file (photo-sized) as a NEW Drive file via a resumable session; the
 * body streams from disk natively. Returns the file id.
 */
export const uploadFileAsync = async (
    accessToken: string,
    name: string,
    parentId: string,
    fileUri: string,
    mimeType: string,
): Promise<string> => {
    // 1. Open a resumable session with the metadata.
    const sessionRes = await driveFetchAsync(
        accessToken,
        "/upload/drive/v3/files?uploadType=resumable&fields=id",
        {
            method: "POST",
            headers: { "Content-Type": "application/json; charset=UTF-8" },
            body: JSON.stringify({ name, parents: [parentId], mimeType }),
            failMessage: "Couldn't start a Drive upload",
        },
    );
    const sessionUri = sessionRes.headers.get("location");
    if (!sessionUri) throw new DriveAccessError("Drive did not return an upload session.", true);

    // 2. Stream the bytes. An interrupted session is simply retried from scratch —
    //    photos are a few MB, not worth chunk-resume bookkeeping.
    const uploadRes = await uploadAsync(sessionUri, fileUri, {
        httpMethod: "PUT",
        uploadType: FileSystemUploadType.BINARY_CONTENT,
        headers: { "Content-Type": mimeType },
    });
    if (uploadRes.status < 200 || uploadRes.status > 299) {
        throw new DriveAccessError(
            `Drive upload failed (${uploadRes.status}).`,
            isTransientStatus(uploadRes.status),
        );
    }
    try {
        const json = JSON.parse(uploadRes.body) as { id?: string };
        if (json.id) return json.id;
    } catch {
        // fall through
    }
    throw new DriveAccessError("Drive did not return a file id after upload.", true);
};

/** Read a small text/JSON file's content. */
export const readTextFileAsync = async (accessToken: string, fileId: string): Promise<string> => {
    const res = await driveFetchAsync(accessToken, `/drive/v3/files/${fileId}?alt=media`, {
        failMessage: "Couldn't read a Drive file",
    });
    return res.text();
};

/** Stream a Drive file's media body into `destUri` (a `file://` path in the cache dir). */
export const downloadToFileAsync = async (
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
        throw new DriveAccessError("A download from Google Drive failed. Please try again.", true);
    }
    if (res.status < 200 || res.status > 299) {
        throw new DriveAccessError(
            `Couldn't download from Drive (${res.status}).`,
            isTransientStatus(res.status),
        );
    }
};

/** Move a file/folder to the Drive trash (user-recoverable for ~30 days). */
export const trashFileAsync = async (accessToken: string, fileId: string): Promise<void> => {
    let res: Response;
    try {
        res = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}`, {
            method: "PATCH",
            headers: {
                Authorization: `Bearer ${accessToken}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({ trashed: true }),
        });
    } catch {
        throw new DriveAccessError("Couldn't reach Google Drive. Check your connection.", true);
    }
    // Already gone is success for a delete.
    if (res.status === 404) return;
    if (!res.ok) {
        throw new DriveAccessError(
            `Couldn't remove a Drive file (${res.status}).`,
            isTransientStatus(res.status),
        );
    }
};

/** Rename a file/folder in place (metadata-only — no bytes are re-uploaded). */
export const renameFileAsync = async (
    accessToken: string,
    fileId: string,
    newName: string,
): Promise<void> => {
    await driveFetchAsync(accessToken, `/drive/v3/files/${fileId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newName }),
        failMessage: "Couldn't rename a Drive file",
    });
};

export type DriveQuota = { usedBytes: number | null; limitBytes: number | null };

/** The account's overall Drive storage quota, for the usage indicator. */
export const getStorageQuotaAsync = async (accessToken: string): Promise<DriveQuota> => {
    const res = await driveFetchAsync(accessToken, "/drive/v3/about?fields=storageQuota", {
        failMessage: "Couldn't read Drive storage info",
    });
    const json = (await res.json()) as {
        storageQuota?: { usage?: string; limit?: string };
    };
    const used = Number.parseInt(json.storageQuota?.usage ?? "", 10);
    const limit = Number.parseInt(json.storageQuota?.limit ?? "", 10);
    return {
        usedBytes: Number.isFinite(used) ? used : null,
        limitBytes: Number.isFinite(limit) ? limit : null,
    };
};
