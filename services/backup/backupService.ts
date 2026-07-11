import * as DocumentPicker from "expo-document-picker";
import { Directory, File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import { strFromU8, strToU8, unzipSync, Zip, ZipPassThrough } from "fflate";

import { BACKUP } from "../../constants/backup";
import { STORAGE } from "../../constants/storage";
import type { Consultation, Patient } from "../../types/models";
import {
    downloadBackupAsync,
    DriveAccessError,
    ensureDriveAccessTokenAsync,
    findLatestBackupAsync,
    getCurrentAccountEmail,
    uploadLatestBackupAsync,
} from "./googleDrive";
import { getOrCreateOriginIdAsync } from "./backupSettingsStore";
import {
    buildManifest,
    MANIFEST_FILE_NAME,
    parseManifest,
    type BackupManifest,
} from "./manifest";
import { folderStampFromCreatedAt } from "../consultation/consultationNumber";
import { bumpDatasetRevision } from "../datasetRevision";
import { clearImageCacheAsync } from "../imageUri";
import { consultationIndexService } from "../indexing/consultationIndexService";
import { patientIndexService } from "../indexing/patientIndexService";
import {
    canonicalizeEmrNumber,
    generateEmrNumberAsync,
    validateEmrNumber,
} from "../patient/emr";
import {
    getOrCreateChildDirectoryAsync,
    listEntriesSafe,
    readJsonFromDir,
    replaceFileInDirectoryAsync,
    safeDeleteDir,
    writeJsonToDir,
} from "../storage/fsUtils";
import {
    getDatasetRootDirectoryAsync,
    getExistingConsultationDir,
    getExistingPatientDir,
    getPatientsRootDirectoryAsync,
    initStorageAsync,
} from "../storage/roots";

/**
 * Import / export / restore the entire dataset as a single `.zip`.
 *
 * The filesystem is the source of truth (see CLAUDE.md), so a faithful copy of the
 * dataset-root tree is a complete backup. The SQLite index is never included — it is
 * rebuilt from disk after an import.
 *
 * Export streams the dataset tree into an in-memory zip (STORE, since JPEGs are already
 * compressed), adds a root `backup.json` manifest, and hands it to the OS share sheet. Import
 * unzips a chosen file and **merges** its patient folders into the existing dataset; restore does
 * the same with the archive pulled from the user's Google Drive. Both rewrite the stored image
 * URIs to their new on-device locations and rebuild the index.
 *
 * Import always merges — it never deletes local data. Identity on import is the **EMR number, and
 * nothing else**, read out of each `patient.json`. A same-EMR record is folded into the existing
 * patient (demographics resolved newest-wins; consultations unioned by their `createdAt`-derived
 * id, newest-wins on a tie). The one exception is surfaced to the user: when a same-EMR record's
 * name clearly differs, the caller may choose to give the incoming record a fresh EMR and add it
 * separately (`addAsNew`) instead of merging. An archived record with no usable EMR cannot be
 * placed, and is counted as `invalid`.
 */

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

/**
 * How to resolve a same-EMR/different-name collision. Only these ever need a user choice; every
 * other collision merges. `merge` folds the incoming record into the local one; `addAsNew` keeps
 * both by giving the incoming record a freshly generated EMR.
 */
export type ImportDecision = "merge" | "addAsNew";

/** One incoming patient, resolved against local data so the UI can decide what to surface. */
export type ArchivePlanEntry = {
    emrNumber: string;
    /** Grouping token in the archive; not an identity. */
    folderName: string;
    incomingName: string;
    /** The local patient's name when this EMR already exists here, else null. */
    localName: string | null;
    /** Whether a patient with this EMR already exists on this device. */
    exists: boolean;
    /** Same EMR, but the names clearly differ — the one case worth surfacing to the user. */
    nameMismatch: boolean;
};

export type ArchiveAnalysis = {
    /** Provenance from the archive's `backup.json`, or null for archives without one. */
    manifest: BackupManifest | null;
    /** Resolvable patients, deduped by EMR (first occurrence wins). */
    plan: ArchivePlanEntry[];
    /** Records repeating an EMR already claimed earlier in the same archive. */
    duplicateInArchive: number;
    /** Records with no usable EMR number. */
    invalid: number;
};

export type ImportSummary = {
    /** Brand-new patients (EMR absent locally). */
    imported: number;
    /** Patients merged into an existing same-EMR record. */
    merged: number;
    /** Name-mismatch records added under a freshly generated EMR. */
    addedAsNew: number;
    /** Records repeating an EMR already claimed earlier in the same archive. */
    duplicateInArchive: number;
    /** Records that couldn't be read/written, or that carry no usable EMR number. */
    invalid: number;
};

export type RestoreResult = ImportSummary & {
    manifest: BackupManifest | null;
    /** The Drive file the records came from — adopt it as the keep-latest backup target. */
    fileId: string;
    /** When that backup was last written, for the "restored from …" confirmation. */
    modifiedTime: string | null;
};

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
    if (lower.endsWith(".webp")) return "image/webp";
    if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
    if (lower.endsWith(".json")) return "application/json";
    return "application/octet-stream";
};

/**
 * A patient's profile photo keeps whatever extension the image format setting had when it was
 * saved, and export writes the folder verbatim — so resolve it by the basename recorded in
 * patient.json, falling back to any top-level `profile.*` entry in the archive.
 */
const resolveProfilePhotoUri = (
    storedUri: string | undefined,
    newUriByRelPath: Record<string, string>,
): string | undefined => {
    if (storedUri) {
        const direct = newUriByRelPath[basename(storedUri)];
        if (direct) return direct;
    }
    const prefix = `${STORAGE.profilePhotoBaseName}.`;
    const relPath = Object.keys(newUriByRelPath).find(
        (rel) => !rel.includes("/") && rel.toLowerCase().startsWith(prefix),
    );
    return relPath ? newUriByRelPath[relPath] : undefined;
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

    // Tally provenance counts from the walk (patient.json / consultation.json / everything else
    // being a photo) for the manifest.
    let patientCount = 0;
    let consultationCount = 0;
    let photoCount = 0;
    for (const { relPath } of files) {
        const name = relPath.split("/").pop() ?? "";
        if (name === STORAGE.patientFileName) patientCount += 1;
        else if (name === STORAGE.consultationFileName) consultationCount += 1;
        else if (!name.toLowerCase().endsWith(".json")) photoCount += 1;
    }

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

    // Add the root manifest last. It sits above `patients/`, so importers ignore it for grouping
    // and archives without one still import (see ./manifest and groupEntriesByPatient).
    const manifest = buildManifest({
        counts: { patients: patientCount, consultations: consultationCount, photos: photoCount },
        email: getCurrentAccountEmail(),
        originId: await getOrCreateOriginIdAsync(),
    });
    const manifestEntry = new ZipPassThrough(MANIFEST_FILE_NAME);
    zip.add(manifestEntry);
    manifestEntry.push(strToU8(JSON.stringify(manifest, null, 2)), true);

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
 * Group flat zip entries by the folder that holds each record. A patient folder is any entry
 * path that contains `.../patients/<folder>/patient.json`; everything nested under that
 * `<folder>` belongs to it. Robust to an optional top-level export folder
 * (e.g. `DermaImageRecords/patients/...`).
 *
 * `<folder>` is a *grouping token only* — never an identity. Identity comes from the EMR
 * number inside `patient.json` (see `readEmrNumberFromEntries`).
 *
 * Returns a map: folderName -> { pathRelativeToPatientFolder -> bytes }.
 */
const groupEntriesByPatient = (entries: Record<string, Uint8Array>): Record<string, Record<string, Uint8Array>> => {
    const groups: Record<string, Record<string, Uint8Array>> = {};

    for (const [rawPath, bytes] of Object.entries(entries)) {
        const parts = rawPath.replace(/\\/g, "/").split("/").filter(Boolean);
        const patientsIdx = parts.indexOf(STORAGE.patientsFolderName);
        // Need ".../patients/<folder>/<at least one more segment>".
        if (patientsIdx === -1 || parts.length <= patientsIdx + 2) continue;

        const folderName = parts[patientsIdx + 1];
        const relWithinPatient = parts.slice(patientsIdx + 2).join("/");

        (groups[folderName] ??= {})[relWithinPatient] = bytes;
    }

    // Keep only groups that actually contain a patient.json (the marker of a real record).
    for (const folderName of Object.keys(groups)) {
        if (!groups[folderName][STORAGE.patientFileName]) {
            delete groups[folderName];
        }
    }

    return groups;
};

/**
 * The canonical EMR number this archived record claims, or `null` when it has none we can use.
 *
 * This is the single point at which an incoming record acquires its identity. We read only
 * `emrNumber` — falling back to the legacy `id` would resurrect the old folder-id identity and
 * let two different patients merge.
 */
const readEmrNumberFromEntries = (entries: Record<string, Uint8Array>): string | null => {
    const bytes = entries[STORAGE.patientFileName];
    if (!bytes) return null;

    try {
        const parsed = JSON.parse(strFromU8(bytes)) as Partial<Patient>;
        const canonical = canonicalizeEmrNumber(parsed.emrNumber);
        return validateEmrNumber(canonical) === null ? canonical : null;
    } catch {
        return null;
    }
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

/** Parse an archived `patient.json`, or null when it's missing/unreadable. */
const readPatientFromEntries = (entries: Record<string, Uint8Array>): Patient | null => {
    const bytes = entries[STORAGE.patientFileName];
    if (!bytes) return null;
    try {
        return JSON.parse(strFromU8(bytes)) as Patient;
    } catch {
        return null;
    }
};

/** Fold case/whitespace for comparing two names. Empty on either side means "no signal". */
const normalizeName = (name: string | null | undefined): string =>
    (name ?? "").trim().replace(/\s+/g, " ").toLowerCase();

/** A consultation from the archive, resolved to the stable folder id it will occupy on disk. */
type ArchiveConsultation = {
    /** Folder the archive stored it under, relative to the patient folder. */
    archiveDirRel: string;
    /** Folder it will occupy here — its `createdAt`-derived timestamp id. */
    stamp: string;
    consultation: Consultation;
};

/**
 * Resolve every consultation in the archive to its stable id. Identity is the timestamp derived
 * from `createdAt` (not the archive's folder name), so a merge lands each visit in the same folder
 * on every device. Within one archive we bump a same-millisecond collision so folders stay unique,
 * realigning `createdAt` to keep the `id === folderStampFromCreatedAt(createdAt)` invariant.
 */
const collectArchiveConsultations = (entries: Record<string, Uint8Array>): ArchiveConsultation[] => {
    const relPaths = Object.keys(entries).filter(
        (rel) =>
            rel.startsWith(`${STORAGE.consultationsFolderName}/`) &&
            rel.endsWith(`/${STORAGE.consultationFileName}`),
    );

    const result: ArchiveConsultation[] = [];
    const usedStamps = new Set<string>();

    for (const relPath of relPaths) {
        let consultation: Consultation;
        try {
            consultation = JSON.parse(strFromU8(entries[relPath])) as Consultation;
        } catch {
            continue; // an unreadable consultation costs that visit, not the whole patient
        }

        const archiveDirRel = relPath.split("/").slice(0, -1).join("/"); // "consultations/<folder>"

        let ms = Date.parse(consultation.createdAt);
        if (Number.isNaN(ms)) ms = 0;
        let stamp = folderStampFromCreatedAt(new Date(ms).toISOString());
        while (usedStamps.has(stamp)) {
            ms += 1;
            stamp = folderStampFromCreatedAt(new Date(ms).toISOString());
        }
        usedStamps.add(stamp);
        consultation.createdAt = new Date(ms).toISOString();

        result.push({ archiveDirRel, stamp, consultation });
    }

    return result;
};

/**
 * Write the top-level (profile) images of a patient group into `patientDir` and resolve the
 * profile photo URI to its freshly-written file. Consultation images live under `consultations/`
 * and are handled per-consultation, so they're skipped here.
 */
const writeProfileImagesAsync = async (
    patientDir: Directory,
    entries: Record<string, Uint8Array>,
    storedProfileUri: string | undefined,
): Promise<string | undefined> => {
    const newUriByRelPath: Record<string, string> = {};
    for (const [relPath, bytes] of Object.entries(entries)) {
        if (relPath.includes("/")) continue; // top-level only
        if (relPath.toLowerCase().endsWith(".json")) continue;
        const dest = await ensureFileForRelPathAsync(patientDir, relPath);
        dest.write(bytes);
        newUriByRelPath[relPath] = dest.uri;
    }
    return resolveProfilePhotoUri(storedProfileUri, newUriByRelPath);
};

/**
 * Write one consultation from the archive into `patientDir` under its canonical stamp folder,
 * copying its images and rewriting `photoUris` to the new on-device files (original order kept,
 * any unreferenced images appended). Overwrites the folder's contents if it already exists.
 */
const writeConsultationFilesAsync = async (
    patientDir: Directory,
    targetEmr: string,
    ac: ArchiveConsultation,
    entries: Record<string, Uint8Array>,
): Promise<void> => {
    const canonicalDirRel = `${STORAGE.consultationsFolderName}/${ac.stamp}`;

    const newUriByBasename: Record<string, string> = {};
    for (const [relPath, bytes] of Object.entries(entries)) {
        if (relPath.toLowerCase().endsWith(".json")) continue;
        if (!relPath.startsWith(`${ac.archiveDirRel}/`)) continue;
        const targetRelPath = `${canonicalDirRel}/${basename(relPath)}`;
        const dest = await ensureFileForRelPathAsync(patientDir, targetRelPath);
        dest.write(bytes);
        newUriByBasename[basename(relPath)] = dest.uri;
    }

    const source = ac.consultation;
    const ordered = (source.photoUris ?? [])
        .map((uri) => newUriByBasename[basename(uri)])
        .filter((uri): uri is string => Boolean(uri));
    const referenced = new Set((source.photoUris ?? []).map(basename));
    const extras = Object.keys(newUriByBasename)
        .filter((name) => !referenced.has(name))
        .sort()
        .map((name) => newUriByBasename[name]);

    const consultation: Consultation = {
        id: ac.stamp,
        patientId: targetEmr,
        remarks: source.remarks ?? "",
        photoUris: [...ordered, ...extras],
        createdAt: source.createdAt,
        updatedAt: source.updatedAt ?? source.createdAt,
    };

    const consultationDir = await ensureDirForRelPathAsync(patientDir, canonicalDirRel);
    await writeJsonToDir(consultationDir, STORAGE.consultationFileName, consultation);
};

/**
 * Write a brand-new patient folder from a group of zip entries, under the folder named by
 * `targetEmr`. Used both for records whose EMR is absent locally and for name-mismatch records
 * the user chose to add under a freshly generated EMR.
 */
const writeNewPatientAsync = async (
    patientsRoot: Directory,
    targetEmr: string,
    entries: Record<string, Uint8Array>,
): Promise<void> => {
    const incoming = readPatientFromEntries(entries);
    if (!incoming) throw new Error("Missing patient.json");

    const patientDir = await getOrCreateChildDirectoryAsync(patientsRoot, targetEmr);
    const profilePhotoUri = await writeProfileImagesAsync(patientDir, entries, incoming.profilePhotoUri);

    for (const ac of collectArchiveConsultations(entries)) {
        await writeConsultationFilesAsync(patientDir, targetEmr, ac, entries);
    }

    const now = new Date().toISOString();
    const patient: Patient = {
        id: targetEmr,
        emrNumber: targetEmr,
        name: (incoming.name ?? "").trim() || "Unnamed",
        age: incoming.age,
        gender: incoming.gender,
        phone: incoming.phone,
        profilePhotoUri,
        createdAt: incoming.createdAt ?? now,
        updatedAt: incoming.updatedAt ?? now,
    };
    await writeJsonToDir(patientDir, STORAGE.patientFileName, patient);

    // Force the per-patient consultation index to rebuild from the freshly-written folders.
    await consultationIndexService.deleteConsultationsByPatientAsync(targetEmr);
};

/** Whether `a`'s updatedAt is strictly newer than `b`'s (missing timestamps sort oldest). */
const isNewer = (a: string | undefined, b: string | undefined): boolean =>
    (Date.parse(a ?? "") || 0) > (Date.parse(b ?? "") || 0);

/**
 * Merge an archived patient into the existing same-EMR record. Nothing local is deleted: patient
 * demographics take whichever side has the newer `updatedAt`, and consultations are unioned by
 * their stamp id — an incoming visit the device lacks is added; a visit both hold is replaced only
 * when the incoming copy is newer.
 */
const mergePatientAsync = async (
    patientsRoot: Directory,
    localEmr: string,
    entries: Record<string, Uint8Array>,
): Promise<void> => {
    const patientDir = getExistingPatientDir(localEmr);
    if (!patientDir) {
        // Raced away since analysis — treat as a fresh write rather than losing the record.
        await writeNewPatientAsync(patientsRoot, localEmr, entries);
        return;
    }

    const incoming = readPatientFromEntries(entries);
    const local = await readJsonFromDir<Patient>(patientDir, STORAGE.patientFileName);
    if (!incoming || !local) throw new Error("Missing patient.json");

    const incomingNewer = isNewer(incoming.updatedAt, local.updatedAt);

    let profilePhotoUri = local.profilePhotoUri;
    if (incomingNewer) {
        // Only overwrite the profile if the incoming record actually carries one.
        const written = await writeProfileImagesAsync(patientDir, entries, incoming.profilePhotoUri);
        if (written) profilePhotoUri = written;
    }

    const merged: Patient = {
        id: localEmr,
        emrNumber: localEmr,
        name: incomingNewer ? (incoming.name ?? "").trim() || local.name : local.name,
        age: incomingNewer ? incoming.age : local.age,
        gender: incomingNewer ? incoming.gender : local.gender,
        phone: incomingNewer ? incoming.phone : local.phone,
        profilePhotoUri,
        createdAt: local.createdAt,
        // Sort fresh: the record was just touched, whichever side won the demographics.
        updatedAt: isNewer(incoming.updatedAt, local.updatedAt) ? incoming.updatedAt : local.updatedAt,
    };

    for (const ac of collectArchiveConsultations(entries)) {
        const existingDir = getExistingConsultationDir(localEmr, ac.stamp);
        if (existingDir) {
            const localCons = await readJsonFromDir<Consultation>(existingDir, STORAGE.consultationFileName);
            if (!isNewer(ac.consultation.updatedAt, localCons?.updatedAt)) continue; // keep local
            await safeDeleteDir(existingDir);
        }
        await writeConsultationFilesAsync(patientDir, localEmr, ac, entries);
    }

    await writeJsonToDir(patientDir, STORAGE.patientFileName, merged);

    // Rebuild the per-patient consultation index from disk (folders changed above).
    await consultationIndexService.deleteConsultationsByPatientAsync(localEmr);
};

/** Generate a fresh EMR that collides with neither the disk nor others minted in this batch. */
const generateReservedEmrAsync = async (reserved: Set<string>): Promise<string> => {
    let emr = await generateEmrNumberAsync();
    while (reserved.has(emr)) emr = await generateEmrNumberAsync();
    reserved.add(emr);
    return emr;
};

/**
 * NOTE: unzipSync holds the decompressed payload in memory. Since exports use STORE, peak
 * memory is roughly twice the dataset size. Callers free each patient's bytes as it is written.
 */
const unzipOrThrow = (zipBytes: Uint8Array, message: string): Record<string, Uint8Array> => {
    try {
        return unzipSync(zipBytes);
    } catch {
        throw new Error(message);
    }
};

/** Thrown when the user backs out of the name-mismatch review, so callers abort without writing. */
export class ImportCancelledError extends Error {
    constructor() {
        super("Import was cancelled.");
        this.name = "ImportCancelledError";
    }
}

/**
 * Ask the caller how to resolve the name-mismatch collisions. Returns per-EMR decisions, or null
 * to cancel the whole import. Only invoked when there is at least one mismatch.
 */
export type DecisionResolver = (
    mismatches: ArchivePlanEntry[],
) => Promise<Record<string, ImportDecision> | null>;

/**
 * Resolve every incoming patient against local data without writing anything. Requires storage to
 * be initialised (it reads local patient.json for name comparison). Also parses the manifest.
 */
export const analyzeArchiveEntriesAsync = async (
    entries: Record<string, Uint8Array>,
): Promise<ArchiveAnalysis> => {
    await initStorageAsync();

    const manifestBytes = entries[MANIFEST_FILE_NAME];
    const manifest = parseManifest(manifestBytes ? strFromU8(manifestBytes) : undefined);

    const groups = groupEntriesByPatient(entries);
    const claimed = new Set<string>();
    const plan: ArchivePlanEntry[] = [];
    let duplicateInArchive = 0;
    let invalid = 0;

    for (const folderName of Object.keys(groups)) {
        const group = groups[folderName];
        const emrNumber = readEmrNumberFromEntries(group);
        if (!emrNumber) {
            invalid += 1;
            continue;
        }
        if (claimed.has(emrNumber)) {
            duplicateInArchive += 1;
            continue;
        }
        claimed.add(emrNumber);

        const incomingName = (readPatientFromEntries(group)?.name ?? "").trim();
        const localDir = getExistingPatientDir(emrNumber);
        let localName: string | null = null;
        let nameMismatch = false;
        if (localDir) {
            const localPatient = await readJsonFromDir<Patient>(localDir, STORAGE.patientFileName);
            localName = (localPatient?.name ?? "").trim();
            const a = normalizeName(incomingName);
            const b = normalizeName(localName);
            nameMismatch = a !== "" && b !== "" && a !== b;
        }

        plan.push({
            emrNumber,
            folderName,
            incomingName,
            localName,
            exists: Boolean(localDir),
            nameMismatch,
        });
    }

    return { manifest, plan, duplicateInArchive, invalid };
};

/**
 * Apply a previously-analyzed archive to disk: brand-new patients are written, same-EMR records
 * merged, and name-mismatch records added under a fresh EMR when the user chose `addAsNew`
 * (default is `merge`). Rebuilds the index afterwards. Never deletes a local patient.
 */
export const applyImportAsync = async (
    entries: Record<string, Uint8Array>,
    analysis: ArchiveAnalysis,
    decisions: Record<string, ImportDecision>,
    onProgress?: ProgressFn,
): Promise<ImportSummary> => {
    const groups = groupEntriesByPatient(entries);
    const patientsRoot = await getPatientsRootDirectoryAsync();

    let imported = 0;
    let merged = 0;
    let addedAsNew = 0;
    let invalid = analysis.invalid;
    const reserved = new Set<string>();

    const { plan } = analysis;
    const total = plan.length;

    for (let i = 0; i < plan.length; i += 1) {
        const entry = plan[i];
        const group = groups[entry.folderName];
        onProgress?.({ phase: "extracting", current: i, total });

        if (!group) {
            invalid += 1;
        } else {
            try {
                if (!entry.exists) {
                    await writeNewPatientAsync(patientsRoot, entry.emrNumber, group);
                    imported += 1;
                } else if (entry.nameMismatch && (decisions[entry.emrNumber] ?? "merge") === "addAsNew") {
                    const newEmr = await generateReservedEmrAsync(reserved);
                    await writeNewPatientAsync(patientsRoot, newEmr, group);
                    addedAsNew += 1;
                } else {
                    await mergePatientAsync(patientsRoot, entry.emrNumber, group);
                    merged += 1;
                }
            } catch {
                invalid += 1;
            }
        }

        delete groups[entry.folderName];
        onProgress?.({ phase: "extracting", current: i + 1, total });
        await tick();
    }

    // The SQLite index is a rebuildable cache: rebuild patients from the freshly-written folders
    // and drop stale render-safe image copies so imported photos re-cache cleanly.
    onProgress?.({ phase: "indexing", current: 0, total: 0 });
    await patientIndexService.rebuildAllPatientsAsync();
    await clearImageCacheAsync();

    // Wake any screen that is already mounted and focused (the restore offered at sign-in lands on
    // the patient list, which would otherwise never re-query).
    bumpDatasetRevision();

    return { imported, merged, addedAsNew, duplicateInArchive: analysis.duplicateInArchive, invalid };
};

/** Pick a `.zip`, read it, and unzip it. Returns null if the user cancels the file picker. */
export const pickAndReadArchiveAsync = async (
    onProgress?: ProgressFn,
): Promise<Record<string, Uint8Array> | null> => {
    onProgress?.({ phase: "reading", current: 0, total: 0 });

    const pickedUri = await pickBackupFileAsync();
    if (!pickedUri) return null;

    let zipBytes: Uint8Array;
    try {
        zipBytes = await new File(pickedUri).bytes();
    } catch {
        throw new Error("Couldn't read the selected file.");
    }

    return unzipOrThrow(zipBytes, "The selected file isn't a valid .zip archive.");
};

// ---------------------------------------------------------------------------
// Restore (Google Drive)
// ---------------------------------------------------------------------------

/**
 * Pull the latest Drive backup and merge it into the dataset — import, with the archive fetched
 * instead of picked. Throws `NoCloudBackupError` when the account has none. When the archive holds
 * name-mismatch collisions and a `resolveDecisions` callback is supplied, it is asked how to
 * resolve them (returning null cancels the restore before anything is written).
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
    try {
        await downloadBackupAsync(accessToken, backup.id, tempFile.uri);

        onProgress?.({ phase: "reading", current: 0, total: 0 });
        const entries = unzipOrThrow(
            await tempFile.bytes(),
            "The cloud backup is damaged and couldn't be read.",
        );

        const analysis = await analyzeArchiveEntriesAsync(entries);
        const mismatches = analysis.plan.filter((p) => p.nameMismatch);
        let decisions: Record<string, ImportDecision> = {};
        if (mismatches.length > 0 && resolveDecisions) {
            const resolved = await resolveDecisions(mismatches);
            if (resolved === null) throw new ImportCancelledError();
            decisions = resolved;
        }

        const summary = await applyImportAsync(entries, analysis, decisions, onProgress);
        return { ...summary, manifest: analysis.manifest, fileId: backup.id, modifiedTime: backup.modifiedTime };
    } finally {
        deleteQuietly(tempFile);
    }
};
