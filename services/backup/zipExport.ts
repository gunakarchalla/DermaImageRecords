import { Directory, File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import { strToU8, Zip, ZipPassThrough } from "fflate";

import { STORAGE } from "../../constants/storage";
import { listEntriesSafe } from "../storage/fsUtils";
import { getDatasetRootDirectoryAsync, initStorageAsync } from "../storage/roots";
import { getCurrentAccountEmail } from "../sync/driveClient";
import { buildManifest, MANIFEST_FILE_NAME } from "./manifest";
import {
    EmptyDatasetError,
    tick,
    type BackupProgress,
    type ProgressFn,
} from "./progress";

/**
 * Export the dataset as a `.zip`, streamed to a cache file — peak memory is one photo,
 * not the whole archive. STORE (no deflate): the payload is almost entirely
 * already-compressed images, so deflating wastes CPU/battery for no gain.
 *
 * The archive is a faithful copy of the dataset-root tree plus a root `backup.json`
 * manifest. v2 records hold only relative paths, so an exported tree is importable on
 * any device byte-for-byte — no URI rewriting on either side.
 */

type WalkedFile = { relPath: string; file: File };

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
 * Which files belong in the archive. `patientIds` limits the export to those patients;
 * `consultations` narrows further to chosen visits of ONE patient (their patient.json and
 * profile photos ride along so the record stays importable). Dataset-root files (the
 * clinic profile) are always included so a partial archive still renders complete
 * reports on the other side.
 */
export type ExportFilter = {
    patientIds?: ReadonlySet<string>;
    consultations?: { patientId: string; cids: ReadonlySet<string> };
};

/** Exported for tests: pure relPath predicate for the filter above. */
export const passesFilter = (relPath: string, filter?: ExportFilter): boolean => {
    if (!filter?.patientIds && !filter?.consultations) return true;

    const parts = relPath.split("/");
    const patientsIdx = parts.indexOf(STORAGE.patientsFolderName);
    if (patientsIdx === -1 || parts.length <= patientsIdx + 1) return true; // root-level file

    const patientId = parts[patientsIdx + 1];

    if (filter.consultations) {
        if (patientId !== filter.consultations.patientId) return false;
        // The patient's own files (patient.json, profile photos, thumbs) always ride along.
        const sub = parts[patientsIdx + 2];
        if (sub !== STORAGE.consultationsFolderName) return true;
        const cid = parts[patientsIdx + 3];
        if (!cid) return true; // the consultations folder itself
        return filter.consultations.cids.has(cid);
    }

    return filter.patientIds!.has(patientId);
};

const backupTimestamp = (): string => {
    const now = new Date();
    const pad = (value: number) => value.toString().padStart(2, "0");
    return (
        `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}` +
        `-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
    );
};

/**
 * Build the archive on disk and return the cache file. The caller owns the file and
 * must delete it when done (share/upload both need a URI anyway).
 */
export const buildBackupZipFileAsync = async (
    onProgress?: ProgressFn,
    filter?: ExportFilter,
): Promise<{ file: File; fileName: string; fileCount: number }> => {
    await initStorageAsync();

    onProgress?.({ phase: "scanning", current: 0, total: 0 });

    const datasetRoot = await getDatasetRootDirectoryAsync();
    const allFiles: WalkedFile[] = [];
    collectFiles(datasetRoot, "", allFiles);
    const files = allFiles.filter(({ relPath }) => passesFilter(relPath, filter));

    if (files.length === 0) {
        throw new EmptyDatasetError();
    }

    const total = files.length;

    // Tally provenance counts (patient.json / consultation.json / non-json under a
    // consultation being a photo) for the manifest.
    let patientCount = 0;
    let consultationCount = 0;
    let photoCount = 0;
    for (const { relPath } of files) {
        const name = relPath.split("/").pop() ?? "";
        if (name === STORAGE.patientFileName) patientCount += 1;
        else if (name === STORAGE.consultationFileName) consultationCount += 1;
        else if (
            !name.toLowerCase().endsWith(".json") &&
            !relPath.includes(`/${STORAGE.thumbsFolderName}/`)
        ) {
            photoCount += 1;
        }
    }

    const fileName = `${STORAGE.externalRootFolderName}-${backupTimestamp()}.zip`;
    const outFile = new File(Paths.cache, fileName);
    outFile.create({ intermediates: true, overwrite: true });
    const handle = outFile.open();

    try {
        // Zip chunks are appended to the output file as they are produced.
        let zipError: Error | null = null;
        const zip = new Zip((err, data) => {
            if (err) {
                zipError = err;
                return;
            }
            handle.writeBytes(data);
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

        // Root manifest last. It sits above `patients/`, so importers ignore it for grouping.
        const manifest = buildManifest({
            counts: { patients: patientCount, consultations: consultationCount, photos: photoCount },
            email: getCurrentAccountEmail(),
        });
        const manifestEntry = new ZipPassThrough(MANIFEST_FILE_NAME);
        zip.add(manifestEntry);
        manifestEntry.push(strToU8(JSON.stringify(manifest, null, 2)), true);

        zip.end();
        if (zipError) throw zipError;
    } finally {
        handle.close();
    }

    return { file: outFile, fileName, fileCount: total };
};

/** A leftover cache file is harmless, so cleanup never masks the real error. */
export const deleteQuietly = (file: File): void => {
    try {
        file.delete();
    } catch {
        // ignore
    }
};

/** Build the archive and hand it to the OS share sheet. */
export const exportDatasetAsync = async (
    onProgress?: ProgressFn,
    filter?: ExportFilter,
): Promise<{ fileName: string; fileCount: number }> => {
    if (!(await Sharing.isAvailableAsync())) {
        throw new Error("Sharing isn't available on this device.");
    }

    const { file, fileName, fileCount } = await buildBackupZipFileAsync(onProgress, filter);
    try {
        await Sharing.shareAsync(file.uri, {
            mimeType: "application/zip",
            dialogTitle: "Export DermaImageRecords backup",
            UTI: "public.zip-archive",
        });
    } finally {
        deleteQuietly(file);
    }

    return { fileName, fileCount };
};

export type { BackupProgress };
