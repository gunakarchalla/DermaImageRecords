import { File, Paths } from "expo-file-system";

import { BACKUP } from "../../constants/backup";
import { initStorageAsync } from "../storage/roots";
import {
    downloadBackupAsync,
    ensureDriveAccessTokenAsync,
    findLatestBackupAsync,
    uploadLatestBackupAsync,
} from "./googleDrive";
import type { BackupManifest } from "./manifest";
import {
    EmptyDatasetError,
    ImportCancelledError,
    isRetryableBackupError,
    NoCloudBackupError,
    describeBackupProgress,
    type BackupPhase,
    type BackupProgress,
    type ProgressFn,
} from "./progress";
import { buildBackupZipFileAsync, deleteQuietly, exportDatasetAsync } from "./zipExport";
import {
    analyzeArchiveEntriesAsync,
    applyImportAsync,
    pickAndReadArchiveAsync,
    readArchiveFileAsync,
    type ArchiveAnalysis,
    type ArchivePlanEntry,
    type DecisionResolver,
    type ImportDecision,
    type ImportSummary,
    type StagedArchive,
} from "./zipImport";

/**
 * Cloud backup / restore orchestration over Google Drive. The zip building and the
 * import/merge machinery live in ./zipExport and ./zipImport; this module only wires
 * them to Drive. (The whole cloud path is superseded by the sync engine in a later
 * phase; local export/import stays.)
 */

export type CloudBackupResult = { fileId: string; fileCount: number };

export type RestoreResult = ImportSummary & {
    manifest: BackupManifest | null;
    /** The Drive file the records came from — adopt it as the keep-latest backup target. */
    fileId: string;
    /** When that backup was last written, for the "restored from …" confirmation. */
    modifiedTime: string | null;
};

/**
 * Build the dataset archive and push it to Google Drive as the single latest backup
 * (keep-only-latest retention). Returns the Drive file id to persist for the next run,
 * so subsequent backups overwrite the same file.
 */
export const backupToDriveAsync = async (
    existingFileId: string | null,
    onProgress?: ProgressFn,
): Promise<CloudBackupResult> => {
    const { file, fileCount } = await buildBackupZipFileAsync(onProgress);

    try {
        onProgress?.({ phase: "uploading", current: 0, total: 0 });
        const accessToken = await ensureDriveAccessTokenAsync();
        const fileId = await uploadLatestBackupAsync(accessToken, file.uri, existingFileId);
        return { fileId, fileCount };
    } finally {
        deleteQuietly(file);
    }
};

/**
 * Pull the latest Drive backup and merge it into the dataset — import, with the archive
 * fetched instead of picked. Throws `NoCloudBackupError` when the account has none.
 */
export const restoreFromDriveAsync = async (
    resolveDecisions?: DecisionResolver,
    onProgress?: ProgressFn,
): Promise<RestoreResult> => {
    onProgress?.({ phase: "searching", current: 0, total: 0 });

    // Drive consent, then the search, before anything touches local storage: on Android
    // `initStorageAsync` opens the SAF folder picker, and there is no sense making the user
    // choose a folder only to be told there was nothing to restore into it.
    const accessToken = await ensureDriveAccessTokenAsync();
    const backup = await findLatestBackupAsync(accessToken);
    if (!backup) throw new NoCloudBackupError();

    await initStorageAsync();

    onProgress?.({ phase: "downloading", current: 0, total: backup.size ?? 0 });
    const tempFile = new File(Paths.cache, BACKUP.driveFileName);
    let staged: StagedArchive | null = null;
    try {
        await downloadBackupAsync(accessToken, backup.id, tempFile.uri);

        staged = await readArchiveFileAsync(tempFile, onProgress);

        const analysis = await analyzeArchiveEntriesAsync(staged);
        const mismatches = analysis.plan.filter((p) => p.nameMismatch);
        let decisions: Record<string, ImportDecision> = {};
        if (mismatches.length > 0 && resolveDecisions) {
            const resolved = await resolveDecisions(mismatches);
            if (resolved === null) throw new ImportCancelledError();
            decisions = resolved;
        }

        const summary = await applyImportAsync(staged, analysis, decisions, onProgress);
        return {
            ...summary,
            manifest: analysis.manifest,
            fileId: backup.id,
            modifiedTime: backup.modifiedTime,
        };
    } finally {
        staged?.dispose();
        deleteQuietly(tempFile);
    }
};

// Re-exports: the stable API surface for screens and providers.
export {
    analyzeArchiveEntriesAsync,
    applyImportAsync,
    describeBackupProgress,
    EmptyDatasetError,
    exportDatasetAsync,
    ImportCancelledError,
    isRetryableBackupError,
    NoCloudBackupError,
    pickAndReadArchiveAsync,
};
export type {
    ArchiveAnalysis,
    ArchivePlanEntry,
    BackupPhase,
    BackupProgress,
    DecisionResolver,
    ImportDecision,
    ImportSummary,
    StagedArchive,
};
