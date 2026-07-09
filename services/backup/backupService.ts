import * as DocumentPicker from "expo-document-picker";
import { Directory, File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import { strFromU8, unzipSync, Zip, ZipPassThrough } from "fflate";

import { STORAGE } from "../../constants/storage";
import type { Consultation, Patient } from "../../types/models";
import { DriveAccessError, ensureDriveAccessTokenAsync, uploadLatestBackupAsync } from "./googleDrive";
import { clearImageCacheAsync } from "../imageUri";
import { patientIndexService } from "../indexing/patientIndexService";
import {
    getOrCreateChildDirectoryAsync,
    listEntriesSafe,
    replaceFileInDirectoryAsync,
    writeJsonToDir,
} from "../storage/fsUtils";
import {
    getDatasetRootDirectoryAsync,
    getExistingPatientDir,
    getPatientsRootDirectoryAsync,
    initStorageAsync,
} from "../storage/roots";

/**
 * Import / export the entire dataset as a single `.zip`.
 *
 * The filesystem is the source of truth (see CLAUDE.md), so a faithful copy of the
 * dataset-root tree is a complete backup. The SQLite index is never included — it is
 * rebuilt from disk after an import.
 *
 * Export streams the dataset tree into an in-memory zip (STORE, since JPEGs are already
 * compressed) and hands it to the OS share sheet. Import unzips a chosen file, merges its
 * patient folders into the existing dataset using a **skip-existing** policy, rewrites the
 * stored image URIs to their new on-device locations, and rebuilds the index.
 */

export type BackupPhase =
    | "scanning"
    | "archiving"
    | "uploading"
    | "reading"
    | "extracting"
    | "indexing";

export type BackupProgress = {
    phase: BackupPhase;
    current: number;
    total: number;
};

export type ImportSummary = {
    imported: number;
    skipped: number;
    invalid: number;
};

export type ImportResult = ({ cancelled: false } & ImportSummary) | { cancelled: true };

/** Thrown when the dataset holds nothing to archive. Retrying can't help until records exist. */
export class EmptyDatasetError extends Error {
    constructor() {
        super("There are no records to export yet.");
        this.name = "EmptyDatasetError";
    }
}

/**
 * Whether repeating a failed backup unattended could plausibly succeed. Drives the automatic
 * retry backoff in ./BackupProvider — errors that need the user (sign in again, grant Drive
 * consent) or that can't change on their own (nothing to back up) must not spin on a timer.
 * Unrecognised failures (a dropped connection, a transient filesystem error) are worth a retry.
 */
export const isRetryableBackupError = (error: unknown): boolean => {
    if (error instanceof EmptyDatasetError) return false;
    if (error instanceof DriveAccessError) return error.retryable;
    return true;
};

type ProgressFn = (progress: BackupProgress) => void;

type WalkedFile = { relPath: string; file: File };

/** Yield to the event loop so progress can paint and the JS thread stays responsive. */
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

const concatBytes = (chunks: Uint8Array[]): Uint8Array => {
    let total = 0;
    for (const chunk of chunks) total += chunk.length;
    const out = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
        out.set(chunk, offset);
        offset += chunk.length;
    }
    return out;
};

/**
 * Last path segment of a plain path OR a URI. SAF `content://` URIs encode their path
 * separators as `%2F`, so we decode first — otherwise the "basename" of a stored photo URI
 * would be the entire document id instead of `<id>.jpg`, breaking the photo-order remap.
 */
const basename = (pathOrUri: string): string => {
    let value = pathOrUri;
    try {
        value = decodeURIComponent(pathOrUri);
    } catch {
        // Not valid percent-encoding — fall back to the raw string.
    }
    value = value.replace(/\\/g, "/");
    const queryOrHash = value.search(/[?#]/);
    if (queryOrHash >= 0) value = value.slice(0, queryOrHash);
    const idx = value.lastIndexOf("/");
    return idx >= 0 ? value.slice(idx + 1) : value;
};

const mimeForFile = (name: string): string => {
    const lower = name.toLowerCase();
    if (lower.endsWith(".png")) return "image/png";
    if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
    if (lower.endsWith(".json")) return "application/json";
    return "application/octet-stream";
};

/** Stage an in-memory archive as a real file in the cache dir (both share + Drive need a URI). */
const writeTempArchive = (bytes: Uint8Array, fileName: string): File => {
    const tempFile = new File(Paths.cache, fileName);
    tempFile.create({ intermediates: true, overwrite: true });
    tempFile.write(bytes);
    return tempFile;
};

/** A leftover cache file is harmless, so cleanup never masks the real error. */
const deleteQuietly = (file: File): void => {
    try {
        file.delete();
    } catch {
        // ignore
    }
};

const backupTimestamp = (): string => {
    const now = new Date();
    const pad = (value: number) => value.toString().padStart(2, "0");
    return (
        `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}` +
        `-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
    );
};

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

/** Recursively collect every file under `dir`, keyed by its path relative to the walk root. */
const collectFiles = (dir: Directory, prefix: string, out: WalkedFile[]) => {
    for (const entry of listEntriesSafe(dir)) {
        if (entry instanceof Directory) {
            collectFiles(entry, `${prefix}${entry.name}/`, out);
        } else {
            out.push({ relPath: `${prefix}${entry.name}`, file: entry });
        }
    }
};

/**
 * Build the dataset backup archive in memory. Shared by local export (share sheet) and
 * cloud backup (Drive upload) so both produce the identical, re-importable `.zip`.
 */
export const buildBackupZipAsync = async (
    onProgress?: ProgressFn,
): Promise<{ bytes: Uint8Array; fileName: string; fileCount: number }> => {
    await initStorageAsync();

    onProgress?.({ phase: "scanning", current: 0, total: 0 });

    const datasetRoot = await getDatasetRootDirectoryAsync();
    const files: WalkedFile[] = [];
    collectFiles(datasetRoot, "", files);

    if (files.length === 0) {
        throw new EmptyDatasetError();
    }

    const total = files.length;

    // Stream file bytes into an in-memory zip. We STORE (no deflate) because the payload is
    // almost entirely already-compressed JPEGs; deflating them wastes CPU/battery for no gain.
    const chunks: Uint8Array[] = [];
    let zipError: Error | null = null;
    const zip = new Zip((err, data) => {
        if (err) {
            zipError = err;
            return;
        }
        chunks.push(data);
    });

    for (let i = 0; i < files.length; i += 1) {
        if (zipError) throw zipError;
        const { relPath, file } = files[i];
        const bytes = await file.bytes();
        const entry = new ZipPassThrough(relPath);
        zip.add(entry);
        entry.push(bytes, true);
        onProgress?.({ phase: "archiving", current: i + 1, total });
        if ((i & 7) === 0) await tick();
    }

    zip.end();
    if (zipError) throw zipError;

    const fileName = `${STORAGE.externalRootFolderName}-${backupTimestamp()}.zip`;
    return { bytes: concatBytes(chunks), fileName, fileCount: total };
};

export const exportDatasetAsync = async (onProgress?: ProgressFn): Promise<{ fileName: string; fileCount: number }> => {
    if (!(await Sharing.isAvailableAsync())) {
        throw new Error("Sharing isn't available on this device.");
    }

    const { bytes: zipBytes, fileName, fileCount } = await buildBackupZipAsync(onProgress);

    // Write the archive to a temp cache file, then let the OS share sheet place it wherever
    // the user chooses ("Save to Files", Drive, email, …).
    const tempFile = writeTempArchive(zipBytes, fileName);

    await Sharing.shareAsync(tempFile.uri, {
        mimeType: "application/zip",
        dialogTitle: "Export DermaImageRecords backup",
        UTI: "public.zip-archive",
    });

    // Best-effort cleanup once the share sheet is dismissed.
    deleteQuietly(tempFile);

    return { fileName, fileCount };
};

// ---------------------------------------------------------------------------
// Cloud backup (Google Drive)
// ---------------------------------------------------------------------------

export type CloudBackupResult = { fileId: string; fileCount: number };

/**
 * Build the dataset archive and push it to Google Drive as the single latest backup
 * (keep-only-latest retention). Returns the Drive file id to persist for the next run,
 * so subsequent backups overwrite the same file. See services/backup/googleDrive.ts.
 */
export const backupToDriveAsync = async (
    existingFileId: string | null,
    onProgress?: ProgressFn,
): Promise<CloudBackupResult> => {
    const { bytes, fileName, fileCount } = await buildBackupZipAsync(onProgress);

    onProgress?.({ phase: "uploading", current: 0, total: 0 });
    // Ask for the token before staging the archive: consent can still fail or be declined
    // here, and there is no point writing a temp file we would immediately delete.
    const accessToken = await ensureDriveAccessTokenAsync();

    // The upload streams from disk rather than from memory — see services/backup/googleDrive.ts.
    const tempFile = writeTempArchive(bytes, fileName);
    try {
        const fileId = await uploadLatestBackupAsync(accessToken, tempFile.uri, existingFileId);
        return { fileId, fileCount };
    } finally {
        deleteQuietly(tempFile);
    }
};

// ---------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------

/** Present the system file picker for a `.zip`. Returns a readable URI, or null if cancelled. */
const pickBackupFileAsync = async (): Promise<string | null> => {
    // Many Android file providers mislabel a `.zip` mime type, so we accept any file and
    // validate by attempting to unzip it below.
    const result = await DocumentPicker.getDocumentAsync({
        type: "*/*",
        copyToCacheDirectory: true,
        multiple: false,
    });

    if (result.canceled) return null;
    return result.assets?.[0]?.uri ?? null;
};

/**
 * Group flat zip entries by patient id. A patient folder is any entry path that contains
 * `.../patients/<id>/patient.json`; everything nested under that `<id>` belongs to it.
 * Robust to an optional top-level export folder (e.g. `DermaImageRecords/patients/...`).
 *
 * Returns a map: patientId -> { pathRelativeToPatientFolder -> bytes }.
 */
const groupEntriesByPatient = (entries: Record<string, Uint8Array>): Record<string, Record<string, Uint8Array>> => {
    const groups: Record<string, Record<string, Uint8Array>> = {};

    for (const [rawPath, bytes] of Object.entries(entries)) {
        const parts = rawPath.replace(/\\/g, "/").split("/").filter(Boolean);
        const patientsIdx = parts.indexOf(STORAGE.patientsFolderName);
        // Need ".../patients/<id>/<at least one more segment>".
        if (patientsIdx === -1 || parts.length <= patientsIdx + 2) continue;

        const patientId = parts[patientsIdx + 1];
        const relWithinPatient = parts.slice(patientsIdx + 2).join("/");

        (groups[patientId] ??= {})[relWithinPatient] = bytes;
    }

    // Keep only groups that actually contain a patient.json (the marker of a real record).
    for (const patientId of Object.keys(groups)) {
        if (!groups[patientId][STORAGE.patientFileName]) {
            delete groups[patientId];
        }
    }

    return groups;
};

const ensureFileForRelPathAsync = async (baseDir: Directory, relPath: string): Promise<File> => {
    const parts = relPath.split("/").filter(Boolean);
    const fileName = parts.pop()!;
    let dir = baseDir;
    for (const part of parts) {
        dir = await getOrCreateChildDirectoryAsync(dir, part);
    }
    return replaceFileInDirectoryAsync(dir, fileName, mimeForFile(fileName));
};

const ensureDirForRelPathAsync = async (baseDir: Directory, relPath: string): Promise<Directory> => {
    let dir = baseDir;
    for (const part of relPath.split("/").filter(Boolean)) {
        dir = await getOrCreateChildDirectoryAsync(dir, part);
    }
    return dir;
};

/**
 * Write one patient folder from a group of zip entries. Images are written first so we can
 * rewrite the stored URIs (profile + consultation photos) to their new on-device locations,
 * preserving the original photo order. The corrected JSON is written last.
 */
const importSinglePatientAsync = async (
    patientsRoot: Directory,
    patientId: string,
    entries: Record<string, Uint8Array>,
): Promise<void> => {
    const patientJsonBytes = entries[STORAGE.patientFileName];
    if (!patientJsonBytes) throw new Error("Missing patient.json");

    const patient = JSON.parse(strFromU8(patientJsonBytes)) as Patient;
    const patientDir = await getOrCreateChildDirectoryAsync(patientsRoot, patientId);

    // 1) Write every non-JSON (image/binary) file, remembering the new URI for each by its
    //    path relative to the patient folder.
    const newUriByRelPath: Record<string, string> = {};
    for (const [relPath, bytes] of Object.entries(entries)) {
        if (relPath.toLowerCase().endsWith(".json")) continue;
        const dest = await ensureFileForRelPathAsync(patientDir, relPath);
        dest.write(bytes);
        newUriByRelPath[relPath] = dest.uri;
    }

    // 2) Point the profile photo at its freshly-written file (if the patient had one).
    patient.id = patientId;
    patient.profilePhotoUri = newUriByRelPath[STORAGE.profilePhotoFileName];

    // 3) Rewrite each consultation's photoUris to the new files, preserving original order.
    const consultationJsonRelPaths = Object.keys(entries).filter(
        (rel) =>
            rel.startsWith(`${STORAGE.consultationsFolderName}/`) &&
            rel.endsWith(`/${STORAGE.consultationFileName}`),
    );

    for (const relPath of consultationJsonRelPaths) {
        const consultation = JSON.parse(strFromU8(entries[relPath])) as Consultation;
        const consultationDirRel = relPath.split("/").slice(0, -1).join("/"); // "consultations/<cid>"

        // Map original photo basenames -> new URIs (files were written with identical names).
        const newUriByBasename: Record<string, string> = {};
        for (const [imgRel, uri] of Object.entries(newUriByRelPath)) {
            if (imgRel.startsWith(`${consultationDirRel}/`)) {
                newUriByBasename[basename(imgRel)] = uri;
            }
        }

        const ordered = (consultation.photoUris ?? [])
            .map((uri) => newUriByBasename[basename(uri)])
            .filter((uri): uri is string => Boolean(uri));

        // Safety net: append any images on disk that weren't referenced by the original list.
        const referenced = new Set((consultation.photoUris ?? []).map(basename));
        const extras = Object.keys(newUriByBasename)
            .filter((name) => !referenced.has(name))
            .sort()
            .map((name) => newUriByBasename[name]);

        consultation.patientId = patientId;
        consultation.photoUris = [...ordered, ...extras];

        const consultationDir = await ensureDirForRelPathAsync(patientDir, consultationDirRel);
        await writeJsonToDir(consultationDir, STORAGE.consultationFileName, consultation);
    }

    // 4) Write the corrected patient.json last.
    await writeJsonToDir(patientDir, STORAGE.patientFileName, patient);
};

export const importDatasetAsync = async (onProgress?: ProgressFn): Promise<ImportResult> => {
    await initStorageAsync();

    onProgress?.({ phase: "reading", current: 0, total: 0 });

    const pickedUri = await pickBackupFileAsync();
    if (!pickedUri) return { cancelled: true };

    let zipBytes: Uint8Array;
    try {
        zipBytes = await new File(pickedUri).bytes();
    } catch {
        throw new Error("Couldn't read the selected file.");
    }

    // NOTE: unzipSync holds the decompressed payload in memory. Since exports use STORE, peak
    // memory is roughly twice the dataset size. We free each patient's bytes as it is written.
    let entries: Record<string, Uint8Array>;
    try {
        entries = unzipSync(zipBytes);
    } catch {
        throw new Error("The selected file isn't a valid .zip archive.");
    }

    const groups = groupEntriesByPatient(entries);
    const patientIds = Object.keys(groups);
    if (patientIds.length === 0) {
        throw new Error("No patient records were found in this file.");
    }

    const patientsRoot = await getPatientsRootDirectoryAsync();

    let imported = 0;
    let skipped = 0;
    let invalid = 0;
    const total = patientIds.length;

    for (let i = 0; i < patientIds.length; i += 1) {
        const patientId = patientIds[i];
        onProgress?.({ phase: "extracting", current: i, total });

        // Skip-existing merge policy: never overwrite a patient that already exists on disk.
        if (getExistingPatientDir(patientId)) {
            skipped += 1;
        } else {
            try {
                await importSinglePatientAsync(patientsRoot, patientId, groups[patientId]);
                imported += 1;
            } catch {
                invalid += 1;
            }
        }

        delete groups[patientId]; // release this patient's bytes for GC
        onProgress?.({ phase: "extracting", current: i + 1, total });
        await tick();
    }

    // The SQLite index is a rebuildable cache: rebuild it from the freshly-written folders and
    // drop stale render-safe image copies so imported photos re-cache cleanly.
    onProgress?.({ phase: "indexing", current: 0, total: 0 });
    await patientIndexService.rebuildAllPatientsAsync();
    await clearImageCacheAsync();

    return { cancelled: false, imported, skipped, invalid };
};
