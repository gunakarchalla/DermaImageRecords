import { File, type Directory } from "expo-file-system";

import { STORAGE } from "../../constants/storage";
import type { PersistedConsultation, PersistedPatient } from "../../types/models";
import {
    findChildDirectory,
    getOrCreateChildDirectoryAsync,
    listEntriesSafe,
    replaceFileInDirectoryAsync,
    safeDeleteDir,
    writeJsonToDir,
} from "./fsUtils";
import { readConsultationRecordAsync, readPatientRecordAsync, renamePhotoFileName } from "./records";
import { getExistingPatientDir, getPatientsRootDirectoryAsync } from "./roots";

/**
 * Local renames for sync collision resolution and chronological renumbering. SAF has no
 * atomic directory rename, so a rename is copy-then-delete: the destination is written
 * completely before the source is removed — a failure mid-way leaves the source intact,
 * and the copy is idempotent so re-running the plan next cycle completes it.
 *
 * Photo files embed `<EMR>-<CID>-`, so renaming a consultation (or its patient) rewrites
 * the contained file names and the consultation.json accordingly.
 */

const mimeForName = (name: string): string => {
    const lower = name.toLowerCase();
    if (lower.endsWith(".png")) return "image/png";
    if (lower.endsWith(".webp")) return "image/webp";
    if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
    if (lower.endsWith(".json")) return "application/json";
    return "application/octet-stream";
};

const copyFileBytesAsync = async (source: File, destDir: Directory, name: string) => {
    const dest = await replaceFileInDirectoryAsync(destDir, name, mimeForName(name));
    dest.write(await source.bytes());
};

/**
 * Copy a consultation folder into `destParent/<toCid>`, rewriting the CID/EMR in the
 * json and in every photo file name. The source is left untouched.
 */
const copyConsultationDirAsync = async (
    source: Directory,
    destParent: Directory,
    toCid: string,
    newEmr: string,
): Promise<boolean> => {
    const record = await readConsultationRecordAsync(source);
    if (!record) return false;

    const oldEmr = record.patientId;
    const oldCid = record.cid;
    const dest = await getOrCreateChildDirectoryAsync(destParent, toCid);

    for (const entry of listEntriesSafe(source)) {
        if (entry instanceof File) {
            if (entry.name === STORAGE.consultationFileName) continue;
            const newName = renamePhotoFileName(entry.name, oldEmr, oldCid, newEmr, toCid);
            await copyFileBytesAsync(entry, dest, newName);
        } else if (entry.name === STORAGE.thumbsFolderName) {
            const thumbsDest = await getOrCreateChildDirectoryAsync(dest, STORAGE.thumbsFolderName);
            for (const t of listEntriesSafe(entry)) {
                if (!(t instanceof File)) continue;
                const newName = renamePhotoFileName(t.name, oldEmr, oldCid, newEmr, toCid);
                await copyFileBytesAsync(t, thumbsDest, newName);
            }
        }
    }

    const photos = (record.photos ?? []).map((entry) => {
        const newFile = renamePhotoFileName(entry.file, oldEmr, oldCid, newEmr, toCid);
        const thumbName = entry.thumb?.split("/").pop();
        const newThumbName = thumbName
            ? renamePhotoFileName(thumbName, oldEmr, oldCid, newEmr, toCid)
            : undefined;
        return {
            ...entry,
            file: newFile,
            thumb: newThumbName ? `${STORAGE.thumbsFolderName}/${newThumbName}` : undefined,
        };
    });

    const updated: PersistedConsultation = {
        ...record,
        id: toCid,
        cid: toCid,
        patientId: newEmr,
        photos,
    };
    await writeJsonToDir(dest, STORAGE.consultationFileName, updated);
    return true;
};

/**
 * Rename a consultation folder to a sibling with a new CID (chronological renumbering).
 * Copy-then-delete; photo names and the json are rewritten.
 */
export const renameConsultationDirAsync = async (
    consultationsDir: Directory,
    fromName: string,
    toCid: string,
    emr: string,
): Promise<void> => {
    const source = findChildDirectory(consultationsDir, fromName);
    if (!source) return;

    const copied = await copyConsultationDirAsync(source, consultationsDir, toCid, emr);
    if (copied) await safeDeleteDir(source);
};

/**
 * Rename a patient folder to a fresh EMR (sync EMR-collision loser). Copies the root
 * files verbatim (profile names don't embed the EMR), renames every consultation's
 * photo prefix (CIDs unchanged), rewrites both jsons, then deletes the old folder.
 */
export const renamePatientDirAsync = async (fromId: string, toEmr: string): Promise<void> => {
    const source = getExistingPatientDir(fromId);
    if (!source) return;

    const record = await readPatientRecordAsync(source);
    if (!record) return;

    const patientsRoot = await getPatientsRootDirectoryAsync();
    const dest = await getOrCreateChildDirectoryAsync(patientsRoot, toEmr);

    for (const entry of listEntriesSafe(source)) {
        if (entry instanceof File) {
            if (entry.name === STORAGE.patientFileName) continue;
            await copyFileBytesAsync(entry, dest, entry.name);
        } else if (entry.name === STORAGE.thumbsFolderName) {
            const thumbsDest = await getOrCreateChildDirectoryAsync(dest, STORAGE.thumbsFolderName);
            for (const t of listEntriesSafe(entry)) {
                if (t instanceof File) await copyFileBytesAsync(t, thumbsDest, t.name);
            }
        } else if (entry.name === STORAGE.consultationsFolderName) {
            const consultationsDest = await getOrCreateChildDirectoryAsync(
                dest,
                STORAGE.consultationsFolderName,
            );
            for (const c of listEntriesSafe(entry)) {
                if (c instanceof File) continue;
                await copyConsultationDirAsync(c, consultationsDest, c.name, toEmr);
            }
        }
    }

    const updated: PersistedPatient = { ...record, id: toEmr, emrNumber: toEmr };
    await writeJsonToDir(dest, STORAGE.patientFileName, updated);

    await safeDeleteDir(source);
};
