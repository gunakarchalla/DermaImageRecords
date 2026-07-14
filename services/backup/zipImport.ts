import * as DocumentPicker from "expo-document-picker";
import { Directory, File, Paths } from "expo-file-system";
import { strFromU8, Unzip, UnzipInflate, UnzipPassThrough } from "fflate";

import { STORAGE } from "../../constants/storage";
import type {
    PersistedConsultation,
    PersistedPatient,
    PhotoEntry,
} from "../../types/models";
import { nextSequentialCid } from "../consultation/cid";
import { bumpDatasetRevision } from "../datasetRevision";
import { clearImageCacheAsync } from "../imageUri";
import { consultationIndexService } from "../indexing/consultationIndexService";
import { patientIndexService } from "../indexing/patientIndexService";
import { folderNameKey } from "../storage/folderNames";
import {
    getOrCreateChildDirectoryAsync,
    listEntriesSafe,
    readJsonFromDir,
    replaceFileInDirectoryAsync,
    safeDeleteDir,
    writeJsonToDir,
} from "../storage/fsUtils";
import { generateEmrNumberAsync, readTakenEmrKeysAsync } from "../patient/emr";
import { isTempFolderName, renamePhotoFileName } from "../storage/records";
import {
    getExistingPatientDir,
    getPatientsRootDirectoryAsync,
    initStorageAsync,
} from "../storage/roots";
import { MANIFEST_FILE_NAME, parseManifest, type BackupManifest } from "./manifest";
import { ImportCancelledError, tick, type ProgressFn } from "./progress";

/**
 * Import a dataset `.zip` by extracting it to a local staging directory (streaming — peak
 * memory is one chunk, not the archive), analyzing it against local data, and merging.
 *
 * Identity: patients match by **EMR number** (case-insensitive); consultations match by
 * their hidden **uid**. Same-CID-different-uid collisions give the incoming consultation
 * the next free sequential CID (its photo files are renamed to match, since they're being
 * written fresh anyway). Import never deletes local data, and replacements are written
 * to a `tmp~` sibling before the old folder is touched — a failure mid-write can no
 * longer lose the local copy.
 *
 * v1 archives (records without uids) are rejected per-record and reported, per the locked
 * decision to ship v2 without migration code.
 */

export type ImportDecision = "merge" | "addAsNew";

export type ArchivePlanEntry = {
    emrNumber: string;
    /** Staging folder name; a grouping token, not an identity. */
    folderName: string;
    incomingName: string;
    localName: string | null;
    exists: boolean;
    /** Same EMR, but the names clearly differ — the one case worth surfacing to the user. */
    nameMismatch: boolean;
};

export type ArchiveAnalysis = {
    manifest: BackupManifest | null;
    /** Resolvable patients, deduped by EMR (first occurrence wins). */
    plan: ArchivePlanEntry[];
    duplicateInArchive: number;
    /** Records that couldn't be read or carry no usable v2 identity. */
    invalid: number;
    /** Of `invalid`: records that parsed but predate the v2 data model. */
    legacy: number;
};

export type ImportSummary = {
    imported: number;
    merged: number;
    addedAsNew: number;
    duplicateInArchive: number;
    invalid: number;
};

export type DecisionResolver = (
    mismatches: ArchivePlanEntry[],
) => Promise<Record<string, ImportDecision> | null>;

/** An archive extracted to local staging. Call `dispose` when finished (also on errors). */
export type StagedArchive = {
    rootDir: Directory;
    dispose: () => void;
};

const STAGING_DIR_NAME = "DermaImageRecordsImportStaging";

const mimeForFile = (name: string): string => {
    const lower = name.toLowerCase();
    if (lower.endsWith(".png")) return "image/png";
    if (lower.endsWith(".webp")) return "image/webp";
    if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
    if (lower.endsWith(".json")) return "application/json";
    return "application/octet-stream";
};

// ---------------------------------------------------------------------------
// Extraction (streaming) into staging
// ---------------------------------------------------------------------------

const READ_CHUNK_SIZE = 1024 * 1024;

/** Reject entry names that could escape the staging dir when joined as paths. */
const isSafeEntryName = (name: string): boolean =>
    !name.includes("..") && !name.startsWith("/") && !name.includes("\\");

/**
 * Extract `zipFile` into a fresh staging directory under the cache, streaming both the
 * read and the inflate so the archive never sits in memory whole.
 */
const extractToStagingAsync = async (
    zipFile: File,
    onProgress?: ProgressFn,
): Promise<StagedArchive> => {
    const stagingRoot = new Directory(
        Paths.cache,
        `${STAGING_DIR_NAME}-${Date.now().toString(36)}`,
    );
    stagingRoot.create({ intermediates: true, idempotent: true });

    const dispose = () => {
        try {
            stagingRoot.delete();
        } catch {
            // Leftover staging is swept on the next import.
        }
    };

    // Sweep stale staging dirs from crashed/aborted imports.
    for (const entry of listEntriesSafe(new Directory(Paths.cache))) {
        if (
            entry instanceof Directory &&
            entry.name.startsWith(STAGING_DIR_NAME) &&
            entry.name !== stagingRoot.name
        ) {
            try {
                entry.delete();
            } catch {
                // ignore
            }
        }
    }

    try {
        let entryError: Error | null = null;
        const pendingWrites: { path: string; chunks: Uint8Array[] }[] = [];

        const unzip = new Unzip((file) => {
            if (!isSafeEntryName(file.name) || file.name.endsWith("/")) return;
            const target = { path: file.name, chunks: [] as Uint8Array[] };
            pendingWrites.push(target);
            file.ondata = (err, chunk, _final) => {
                if (err) {
                    entryError = err;
                    return;
                }
                if (chunk?.length) target.chunks.push(chunk);
            };
            file.start();
        });
        unzip.register(UnzipPassThrough);
        unzip.register(UnzipInflate);

        const handle = zipFile.open();
        try {
            const size = handle.size ?? 0;
            let offset = 0;
            while (offset < size) {
                const length = Math.min(READ_CHUNK_SIZE, size - offset);
                handle.offset = offset;
                const chunk = handle.readBytes(length);
                unzip.push(chunk, offset + length >= size);
                offset += length;

                if (entryError) throw new Error("The selected file isn't a valid .zip archive.");

                // Flush completed entries to disk between chunks to bound memory.
                while (pendingWrites.length > 1) {
                    const done = pendingWrites.shift()!;
                    await writeStagedEntryAsync(stagingRoot, done.path, done.chunks);
                }
                onProgress?.({ phase: "reading", current: offset, total: size });
                await tick();
            }
        } finally {
            handle.close();
        }

        if (entryError) throw new Error("The selected file isn't a valid .zip archive.");
        for (const pending of pendingWrites) {
            await writeStagedEntryAsync(stagingRoot, pending.path, pending.chunks);
        }

        return { rootDir: stagingRoot, dispose };
    } catch (error) {
        dispose();
        throw error;
    }
};

const writeStagedEntryAsync = async (root: Directory, relPath: string, chunks: Uint8Array[]) => {
    const parts = relPath.split("/").filter(Boolean);
    const fileName = parts.pop();
    if (!fileName) return;

    let dir = root;
    for (const part of parts) {
        dir = new Directory(dir, part);
        dir.create({ intermediates: true, idempotent: true });
    }

    const out = new File(dir, fileName);
    out.create({ overwrite: true });
    const handle = out.open();
    try {
        for (const chunk of chunks) handle.writeBytes(chunk);
    } finally {
        handle.close();
    }
};

/** Present the system file picker for a `.zip`, extract it to staging. Null if cancelled. */
export const pickAndReadArchiveAsync = async (
    onProgress?: ProgressFn,
): Promise<StagedArchive | null> => {
    onProgress?.({ phase: "reading", current: 0, total: 0 });

    // Many Android file providers mislabel a `.zip` mime type, so accept any file and
    // validate by attempting to extract it.
    const result = await DocumentPicker.getDocumentAsync({
        type: "*/*",
        copyToCacheDirectory: true,
        multiple: false,
    });
    if (result.canceled) return null;
    const uri = result.assets?.[0]?.uri;
    if (!uri) return null;

    return extractToStagingAsync(new File(uri), onProgress);
};

/** Extract an already-downloaded archive file (the Drive restore path). */
export const readArchiveFileAsync = (
    file: File,
    onProgress?: ProgressFn,
): Promise<StagedArchive> => extractToStagingAsync(file, onProgress);

// ---------------------------------------------------------------------------
// Analysis
// ---------------------------------------------------------------------------

/**
 * The staged patient folders: `<staging>/[wrapper/]patients/<folder>`. Tolerates one
 * optional top-level wrapper folder (e.g. `DermaImageRecords/patients/...`).
 */
const findStagedPatientsRoot = (staged: StagedArchive): Directory | null => {
    const direct = listEntriesSafe(staged.rootDir).find(
        (e): e is Directory => e instanceof Directory && e.name === STORAGE.patientsFolderName,
    );
    if (direct) return direct;

    for (const entry of listEntriesSafe(staged.rootDir)) {
        if (!(entry instanceof Directory)) continue;
        const nested = listEntriesSafe(entry).find(
            (e): e is Directory => e instanceof Directory && e.name === STORAGE.patientsFolderName,
        );
        if (nested) return nested;
    }
    return null;
};

const findStagedManifest = async (staged: StagedArchive): Promise<BackupManifest | null> => {
    const tryRead = async (dir: Directory) => {
        const file = listEntriesSafe(dir).find(
            (e): e is File => e instanceof File && e.name === MANIFEST_FILE_NAME,
        );
        if (!file) return null;
        try {
            return parseManifest(await file.text());
        } catch {
            return null;
        }
    };

    const atRoot = await tryRead(staged.rootDir);
    if (atRoot) return atRoot;
    for (const entry of listEntriesSafe(staged.rootDir)) {
        if (entry instanceof Directory) {
            const nested = await tryRead(entry);
            if (nested) return nested;
        }
    }
    return null;
};

/** Fold case/whitespace for comparing two names. Empty on either side means "no signal". */
const normalizeName = (name: string | null | undefined): string =>
    (name ?? "").trim().replace(/\s+/g, " ").toLowerCase();

type StagedPatientRecord = {
    dir: Directory;
    record: PersistedPatient;
};

/** Read a staged patient.json; distinguishes v2, legacy (pre-uid), and unreadable. */
const readStagedPatientAsync = async (
    dir: Directory,
): Promise<{ kind: "v2"; record: PersistedPatient } | { kind: "legacy" } | { kind: "invalid" }> => {
    const json = await readJsonFromDir<PersistedPatient>(dir, STORAGE.patientFileName);
    if (!json) return { kind: "invalid" };
    if (typeof json.uid !== "string" || !json.uid) return { kind: "legacy" };
    const emr = (json.emrNumber ?? "").toString();
    if (!emr.trim()) return { kind: "invalid" };
    return { kind: "v2", record: json };
};

/**
 * Resolve every incoming patient against local data without writing anything. Requires
 * storage to be initialised (it reads local patient.json for name comparison).
 */
export const analyzeArchiveEntriesAsync = async (
    staged: StagedArchive,
): Promise<ArchiveAnalysis> => {
    await initStorageAsync();

    const manifest = await findStagedManifest(staged);
    const patientsRoot = findStagedPatientsRoot(staged);

    const plan: ArchivePlanEntry[] = [];
    const claimed = new Set<string>();
    let duplicateInArchive = 0;
    let invalid = 0;
    let legacy = 0;

    if (patientsRoot) {
        for (const entry of listEntriesSafe(patientsRoot)) {
            if (!(entry instanceof Directory)) continue;

            const read = await readStagedPatientAsync(entry);
            if (read.kind === "legacy") {
                invalid += 1;
                legacy += 1;
                continue;
            }
            if (read.kind === "invalid") {
                invalid += 1;
                continue;
            }

            const emrNumber = read.record.emrNumber.normalize("NFC").trim();
            const emrKey = folderNameKey(emrNumber);
            if (claimed.has(emrKey)) {
                duplicateInArchive += 1;
                continue;
            }
            claimed.add(emrKey);

            const localDir =
                getExistingPatientDir(emrNumber) ?? (await findLocalPatientDirByKeyAsync(emrKey));
            let localName: string | null = null;
            let nameMismatch = false;
            if (localDir) {
                const localPatient = await readJsonFromDir<PersistedPatient>(
                    localDir,
                    STORAGE.patientFileName,
                );
                localName = (localPatient?.name ?? "").trim();
                const a = normalizeName(read.record.name);
                const b = normalizeName(localName);
                nameMismatch = a !== "" && b !== "" && a !== b;
            }

            plan.push({
                emrNumber,
                folderName: entry.name,
                incomingName: (read.record.name ?? "").trim(),
                localName,
                exists: Boolean(localDir),
                nameMismatch,
            });
        }
    }

    return { manifest, plan, duplicateInArchive, invalid, legacy };
};

/**
 * Local patient dir whose folder name matches `emrKey` case-insensitively.
 * `getExistingPatientDir` matches exact names; a case-variant EMR is still the same
 * patient on a case-insensitive filesystem, so scan by key.
 */
const findLocalPatientDirByKeyAsync = async (emrKey: string): Promise<Directory | null> => {
    try {
        const root = await getPatientsRootDirectoryAsync();
        for (const entry of listEntriesSafe(root)) {
            if (entry instanceof Directory && folderNameKey(entry.name) === emrKey) {
                return entry;
            }
        }
        return null;
    } catch {
        return null;
    }
};

// ---------------------------------------------------------------------------
// Apply (merge into the live dataset)
// ---------------------------------------------------------------------------

/** Copy a staged file's bytes into `destDir` under `name`. */
const copyStagedFileAsync = async (source: File, destDir: Directory, name: string) => {
    const dest = await replaceFileInDirectoryAsync(destDir, name, mimeForFile(name));
    dest.write(await source.bytes());
};


/**
 * Write one staged consultation into the live patient folder under `targetCid`, renaming
 * photo files when the EMR or CID changed. Photos listed in the record but missing from
 * staging are dropped; staged image files not listed are appended as recovered entries.
 */
const writeConsultationFromStagingAsync = async (
    liveConsultationsDir: Directory,
    stagedDir: Directory,
    record: PersistedConsultation,
    targetEmr: string,
    targetCid: string,
    targetFolderName: string,
): Promise<void> => {
    const destDir = await getOrCreateChildDirectoryAsync(liveConsultationsDir, targetFolderName);

    const stagedFiles = new Map<string, File>();
    let stagedThumbs: Map<string, File> = new Map();
    for (const entry of listEntriesSafe(stagedDir)) {
        if (entry instanceof File) stagedFiles.set(entry.name, entry);
        else if (entry.name === STORAGE.thumbsFolderName) {
            for (const t of listEntriesSafe(entry)) {
                if (t instanceof File) stagedThumbs.set(t.name, t);
            }
        }
    }

    const oldEmr = record.patientId;
    const oldCid = record.cid;

    const photos: PhotoEntry[] = [];
    const usedNames = new Set<string>();

    for (const entry of record.photos ?? []) {
        const source = stagedFiles.get(entry.file);
        if (!source) continue;

        const newName = renamePhotoFileName(entry.file, oldEmr, oldCid, targetEmr, targetCid);
        await copyStagedFileAsync(source, destDir, newName);
        usedNames.add(entry.file);

        let thumb: string | undefined;
        if (entry.thumb) {
            const thumbName = entry.thumb.split("/").pop() ?? "";
            const stagedThumb = stagedThumbs.get(thumbName);
            if (stagedThumb) {
                const newThumbName = renamePhotoFileName(thumbName, oldEmr, oldCid, targetEmr, targetCid);
                const thumbsDir = await getOrCreateChildDirectoryAsync(
                    destDir,
                    STORAGE.thumbsFolderName,
                );
                await copyStagedFileAsync(stagedThumb, thumbsDir, newThumbName);
                thumb = `${STORAGE.thumbsFolderName}/${newThumbName}`;
            }
        }

        photos.push({ ...entry, file: newName, thumb });
    }

    // Recover image files present in staging but unlisted in the record (defensive).
    for (const [name, source] of stagedFiles) {
        if (usedNames.has(name)) continue;
        if (name.toLowerCase().endsWith(".json")) continue;
        const newName = renamePhotoFileName(name, oldEmr, oldCid, targetEmr, targetCid);
        await copyStagedFileAsync(source, destDir, newName);
        photos.push({
            uid: `${record.uid}-recovered-${photos.length}`,
            file: newName,
            capturedAt: record.createdAt,
        });
    }

    const consultation: PersistedConsultation = {
        ...record,
        id: targetCid,
        cid: targetCid,
        patientId: targetEmr,
        photos,
        nextPhotoNumber: Math.max(record.nextPhotoNumber ?? 1, 1),
    };
    await writeJsonToDir(destDir, STORAGE.consultationFileName, consultation);
};

/** The staged consultations of one patient. */
const listStagedConsultationsAsync = async (
    stagedPatientDir: Directory,
): Promise<{ dir: Directory; record: PersistedConsultation }[]> => {
    const consultationsDir = listEntriesSafe(stagedPatientDir).find(
        (e): e is Directory =>
            e instanceof Directory && e.name === STORAGE.consultationsFolderName,
    );
    if (!consultationsDir) return [];

    const out: { dir: Directory; record: PersistedConsultation }[] = [];
    for (const entry of listEntriesSafe(consultationsDir)) {
        if (!(entry instanceof Directory) || isTempFolderName(entry.name)) continue;
        const record = await readJsonFromDir<PersistedConsultation>(
            entry,
            STORAGE.consultationFileName,
        );
        if (!record || typeof record.uid !== "string" || !record.uid) continue;
        out.push({ dir: entry, record: { ...record, cid: record.cid || entry.name } });
    }
    return out;
};

/** Copy the staged patient's top-level files (patient.json is rewritten separately). */
const copyPatientRootFilesAsync = async (
    stagedPatientDir: Directory,
    livePatientDir: Directory,
) => {
    for (const entry of listEntriesSafe(stagedPatientDir)) {
        if (entry instanceof File && entry.name !== STORAGE.patientFileName) {
            await copyStagedFileAsync(entry, livePatientDir, entry.name);
        } else if (entry instanceof Directory && entry.name === STORAGE.thumbsFolderName) {
            const thumbsDir = await getOrCreateChildDirectoryAsync(
                livePatientDir,
                STORAGE.thumbsFolderName,
            );
            for (const t of listEntriesSafe(entry)) {
                if (t instanceof File) await copyStagedFileAsync(t, thumbsDir, t.name);
            }
        }
    }
};

/** Write a brand-new patient from staging under `targetEmr`. */
const writeNewPatientAsync = async (
    patientsRoot: Directory,
    targetEmr: string,
    staged: StagedPatientRecord,
): Promise<void> => {
    const patientDir = await getOrCreateChildDirectoryAsync(patientsRoot, targetEmr);
    await copyPatientRootFilesAsync(staged.dir, patientDir);

    const liveConsultationsDir = await getOrCreateChildDirectoryAsync(
        patientDir,
        STORAGE.consultationsFolderName,
    );
    const usedCids: string[] = [];
    for (const { dir, record } of await listStagedConsultationsAsync(staged.dir)) {
        let cid = record.cid;
        if (usedCids.some((used) => folderNameKey(used) === folderNameKey(cid))) {
            cid = nextSequentialCid(usedCids);
        }
        usedCids.push(cid);
        await writeConsultationFromStagingAsync(
            liveConsultationsDir,
            dir,
            record,
            targetEmr,
            cid,
            cid,
        );
    }

    const patient: PersistedPatient = {
        ...staged.record,
        id: targetEmr,
        emrNumber: targetEmr,
        name: (staged.record.name ?? "").trim() || "Unnamed",
    };
    await writeJsonToDir(patientDir, STORAGE.patientFileName, patient);

    await consultationIndexService.deleteConsultationsByPatientAsync(targetEmr);
};

/** Whether `a`'s updatedAt is strictly newer than `b`'s (missing timestamps sort oldest). */
const isNewer = (a: string | undefined, b: string | undefined): boolean =>
    (Date.parse(a ?? "") || 0) > (Date.parse(b ?? "") || 0);

/**
 * Merge a staged patient into the existing same-EMR record. Demographics take whichever
 * side has the newer `updatedAt`; consultations union by uid. A shared uid is replaced
 * only when the incoming copy is strictly newer (written to a `tmp~` sibling before the
 * local folder is deleted — no delete-before-write window). A CID collision between
 * different uids gives the incoming consultation the next free sequential CID.
 */
const mergePatientAsync = async (
    patientsRoot: Directory,
    localEmr: string,
    staged: StagedPatientRecord,
): Promise<void> => {
    const patientDir = getExistingPatientDir(localEmr);
    if (!patientDir) {
        // Raced away since analysis — treat as a fresh write rather than losing the record.
        await writeNewPatientAsync(patientsRoot, localEmr, staged);
        return;
    }

    const local = await readJsonFromDir<PersistedPatient>(patientDir, STORAGE.patientFileName);
    if (!local) throw new Error("Missing patient.json");
    const incoming = staged.record;

    const incomingNewer = isNewer(incoming.updatedAt, local.updatedAt);
    if (incomingNewer && incoming.profilePhoto) {
        await copyPatientRootFilesAsync(staged.dir, patientDir);
    }

    const merged: PersistedPatient = {
        schema: 2,
        uid: local.uid,
        id: localEmr,
        emrNumber: localEmr,
        name: incomingNewer ? (incoming.name ?? "").trim() || local.name : local.name,
        age: incomingNewer ? incoming.age : local.age,
        gender: incomingNewer ? incoming.gender : local.gender,
        phone: incomingNewer ? incoming.phone : local.phone,
        profilePhoto: incomingNewer && incoming.profilePhoto ? incoming.profilePhoto : local.profilePhoto,
        profileThumb: incomingNewer && incoming.profilePhoto ? incoming.profileThumb : local.profileThumb,
        createdAt: local.createdAt,
        updatedAt: incomingNewer ? incoming.updatedAt : local.updatedAt,
    };

    // Local consultation inventory: uid → { dir name, record }.
    const liveConsultationsDir = await getOrCreateChildDirectoryAsync(
        patientDir,
        STORAGE.consultationsFolderName,
    );
    const localByUid = new Map<string, { folderName: string; record: PersistedConsultation }>();
    const localNames: string[] = [];
    for (const entry of listEntriesSafe(liveConsultationsDir)) {
        if (!(entry instanceof Directory) || isTempFolderName(entry.name)) continue;
        localNames.push(entry.name);
        const record = await readJsonFromDir<PersistedConsultation>(
            entry,
            STORAGE.consultationFileName,
        );
        if (record?.uid) localByUid.set(record.uid, { folderName: entry.name, record });
    }

    for (const { dir, record } of await listStagedConsultationsAsync(staged.dir)) {
        const localMatch = localByUid.get(record.uid);

        if (localMatch) {
            // Same visit on both sides: whole-record newest-wins.
            if (!isNewer(record.updatedAt, localMatch.record.updatedAt)) continue;

            // Write-then-swap: incoming lands in a temp sibling first, so a failure here
            // leaves the local copy untouched.
            const tempName = `tmp~${Date.now().toString(36)}`;
            await writeConsultationFromStagingAsync(
                liveConsultationsDir,
                dir,
                record,
                localEmr,
                record.cid,
                tempName,
            );

            const oldDir = listEntriesSafe(liveConsultationsDir).find(
                (e): e is Directory => e instanceof Directory && e.name === localMatch.folderName,
            );
            if (oldDir) await safeDeleteDir(oldDir);

            // The winner's CID names the final folder; free it if a *different* local
            // consultation holds that name.
            let finalCid = record.cid;
            const conflict = localNames.some(
                (name) =>
                    name !== localMatch.folderName &&
                    folderNameKey(name) === folderNameKey(finalCid),
            );
            if (conflict) finalCid = nextSequentialCid(localNames);

            await writeConsultationFromStagingAsync(
                liveConsultationsDir,
                dir,
                record,
                localEmr,
                finalCid,
                finalCid,
            );
            const tempDir = listEntriesSafe(liveConsultationsDir).find(
                (e): e is Directory => e instanceof Directory && e.name === tempName,
            );
            if (tempDir) await safeDeleteDir(tempDir);

            localNames.splice(localNames.indexOf(localMatch.folderName), 1, finalCid);
            continue;
        }

        // New visit for this device. Resolve a CID collision with a different local visit.
        let cid = record.cid;
        if (localNames.some((name) => folderNameKey(name) === folderNameKey(cid))) {
            cid = nextSequentialCid(localNames);
        }
        localNames.push(cid);
        await writeConsultationFromStagingAsync(
            liveConsultationsDir,
            dir,
            record,
            localEmr,
            cid,
            cid,
        );
    }

    await writeJsonToDir(patientDir, STORAGE.patientFileName, merged);
    await consultationIndexService.deleteConsultationsByPatientAsync(localEmr);
};

/**
 * Apply a previously-analyzed archive: new patients written, same-EMR records merged,
 * name-mismatch records added under a fresh EMR when the user chose `addAsNew`.
 * Rebuilds the index afterwards. Never deletes a local patient.
 */
export const applyImportAsync = async (
    staged: StagedArchive,
    analysis: ArchiveAnalysis,
    decisions: Record<string, ImportDecision>,
    onProgress?: ProgressFn,
): Promise<ImportSummary> => {
    const stagedPatientsRoot = findStagedPatientsRoot(staged);
    const patientsRoot = await getPatientsRootDirectoryAsync();

    let imported = 0;
    let merged = 0;
    let addedAsNew = 0;
    let invalid = analysis.invalid;

    // One disk listing for the whole batch; generated EMRs also reserve into it.
    const takenEmrKeys = await readTakenEmrKeysAsync();

    const { plan } = analysis;
    const total = plan.length;

    for (let i = 0; i < plan.length; i += 1) {
        const entry = plan[i];
        onProgress?.({ phase: "extracting", current: i, total });

        const stagedDir = stagedPatientsRoot
            ? listEntriesSafe(stagedPatientsRoot).find(
                  (e): e is Directory => e instanceof Directory && e.name === entry.folderName,
              )
            : null;
        const read = stagedDir ? await readStagedPatientAsync(stagedDir) : null;

        if (!stagedDir || !read || read.kind !== "v2") {
            invalid += 1;
        } else {
            const stagedRecord: StagedPatientRecord = { dir: stagedDir, record: read.record };
            try {
                if (!entry.exists) {
                    await writeNewPatientAsync(patientsRoot, entry.emrNumber, stagedRecord);
                    takenEmrKeys.add(folderNameKey(entry.emrNumber));
                    imported += 1;
                } else if (
                    entry.nameMismatch &&
                    (decisions[entry.emrNumber] ?? "merge") === "addAsNew"
                ) {
                    const newEmr = await generateEmrNumberAsync(takenEmrKeys);
                    takenEmrKeys.add(folderNameKey(newEmr));
                    await writeNewPatientAsync(patientsRoot, newEmr, stagedRecord);
                    addedAsNew += 1;
                } else {
                    await mergePatientAsync(patientsRoot, entry.emrNumber, stagedRecord);
                    merged += 1;
                }
            } catch {
                invalid += 1;
            }
        }

        onProgress?.({ phase: "extracting", current: i + 1, total });
        await tick();
    }

    // The SQLite index is a rebuildable cache: rebuild patients from the freshly-written
    // folders and drop stale render-safe image copies so imported photos re-cache cleanly.
    onProgress?.({ phase: "indexing", current: 0, total: 0 });
    await patientIndexService.rebuildAllPatientsAsync();
    await clearImageCacheAsync();

    // Wake any screen that is already mounted and focused.
    bumpDatasetRevision();

    return { imported, merged, addedAsNew, duplicateInArchive: analysis.duplicateInArchive, invalid };
};

export { ImportCancelledError };
