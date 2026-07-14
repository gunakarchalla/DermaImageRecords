import { DriveAccessError } from "../sync/driveClient";

/** Shared progress/error vocabulary for export, import, cloud backup, and restore. */

export type BackupPhase =
    | "scanning"
    | "archiving"
    | "uploading"
    | "searching"
    | "downloading"
    | "reading"
    | "extracting"
    | "indexing";

export type BackupProgress = {
    phase: BackupPhase;
    current: number;
    total: number;
};

export type ProgressFn = (progress: BackupProgress) => void;

/** Human-readable status for a running backup/import/restore, shared by every progress overlay. */
export const describeBackupProgress = (progress: BackupProgress | null): string => {
    if (!progress) return "Working…";
    switch (progress.phase) {
        case "scanning":
            return "Scanning records…";
        case "archiving":
            return progress.total
                ? `Archiving ${progress.current} of ${progress.total}…`
                : "Archiving…";
        case "uploading":
            return "Uploading to Google Drive…";
        case "searching":
            return "Looking for a backup…";
        case "downloading":
            return "Downloading backup…";
        case "reading":
            return "Reading file…";
        case "extracting":
            return progress.total
                ? `Importing ${progress.current} of ${progress.total}…`
                : "Importing…";
        case "indexing":
            return "Rebuilding index…";
        default:
            return "Working…";
    }
};

/** Yield to the event loop so progress can paint and the JS thread stays responsive. */
export const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/** Thrown when the dataset holds nothing to archive. Retrying can't help until records exist. */
export class EmptyDatasetError extends Error {
    constructor() {
        super("There are no records to export yet.");
        this.name = "EmptyDatasetError";
    }
}

/** Thrown when the signed-in account has no backup archive in Drive. Not a failure — an answer. */
export class NoCloudBackupError extends Error {
    constructor() {
        super("No backup was found in your Google Drive.");
        this.name = "NoCloudBackupError";
    }
}

/** Thrown when the user backs out of the name-mismatch review, so callers abort without writing. */
export class ImportCancelledError extends Error {
    constructor() {
        super("Import was cancelled.");
        this.name = "ImportCancelledError";
    }
}

/**
 * Whether repeating a failed backup unattended could plausibly succeed. Drives the automatic
 * retry backoff in services/sync/SyncProvider — errors that need the user (sign in again, grant Drive
 * consent) or that can't change on their own (nothing to back up) must not spin on a timer.
 * Unrecognised failures (a dropped connection, a transient filesystem error) are worth a retry.
 */
export const isRetryableBackupError = (error: unknown): boolean => {
    if (error instanceof EmptyDatasetError) return false;
    if (error instanceof DriveAccessError) return error.retryable;
    return true;
};
