import { Directory, File } from "expo-file-system";

import { STORAGE } from "../../constants/storage";
import type {
    Consultation,
    Patient,
    PersistedConsultation,
    PersistedPatient,
} from "../../types/models";
import { findChildDirectory, listEntriesSafe, readJsonFromDir } from "./fsUtils";

/**
 * Reading + resolving v2 records. JSON on disk holds RELATIVE file names; these helpers
 * turn them into absolute, device-local URIs by listing the record's folder once. Shared
 * by the storage layer and the index services (which must not import storage.ts — it
 * imports them).
 */

/** One listing → name→File map. SAF child URIs can't be constructed, only discovered. */
export const listFilesByName = (dir: Directory): Map<string, File> => {
    const map = new Map<string, File>();
    for (const entry of listEntriesSafe(dir)) {
        if (entry instanceof File) map.set(entry.name, entry);
    }
    return map;
};

/** Strip a `thumbs/` prefix: persisted thumb paths are relative to the record folder. */
const thumbFileName = (thumbPath: string): string =>
    thumbPath.startsWith(`${STORAGE.thumbsFolderName}/`)
        ? thumbPath.slice(STORAGE.thumbsFolderName.length + 1)
        : thumbPath;

/**
 * Read a v2 patient record, or `null` when missing/corrupt/legacy. Records without a
 * `uid` (schema 1) are deliberately unreadable — the dataset is expected to be rebuilt
 * in the v2 format, and half-understanding an old record risks corrupting it.
 */
export const readPatientRecordAsync = async (dir: Directory): Promise<PersistedPatient | null> => {
    const json = await readJsonFromDir<PersistedPatient>(dir, STORAGE.patientFileName);
    if (!json || typeof json.uid !== "string" || !json.uid) return null;
    return json;
};

/** Fill in the resolved URI fields for a patient from its folder contents. */
export const resolvePatient = (dir: Directory, persisted: PersistedPatient): Patient => {
    const files = listFilesByName(dir);
    const thumbsDir = findChildDirectory(dir, STORAGE.thumbsFolderName);
    const thumbFiles = thumbsDir ? listFilesByName(thumbsDir) : null;

    return {
        ...persisted,
        profilePhotoUri: persisted.profilePhoto
            ? files.get(persisted.profilePhoto)?.uri
            : undefined,
        profileThumbUri: persisted.profileThumb
            ? thumbFiles?.get(thumbFileName(persisted.profileThumb))?.uri
            : undefined,
    };
};

export const readPatientAsync = async (dir: Directory): Promise<Patient | null> => {
    const persisted = await readPatientRecordAsync(dir);
    return persisted ? resolvePatient(dir, persisted) : null;
};

/** Read a v2 consultation record, or `null` when missing/corrupt/legacy. */
export const readConsultationRecordAsync = async (
    dir: Directory,
): Promise<PersistedConsultation | null> => {
    const json = await readJsonFromDir<PersistedConsultation>(dir, STORAGE.consultationFileName);
    if (!json || typeof json.uid !== "string" || !json.uid || !Array.isArray(json.photos)) {
        return null;
    }
    return json;
};

/**
 * Fill in the resolved URI fields for a consultation. Photos whose file is missing on
 * disk (deleted externally) are dropped from the runtime arrays — `photos`, `photoUris`,
 * and `thumbUris` stay parallel. The persisted record is left as-is; the next save
 * rewrites it from the surviving entries.
 */
export const resolveConsultation = (
    dir: Directory,
    persisted: PersistedConsultation,
): Consultation => {
    const files = listFilesByName(dir);
    const thumbsDir = findChildDirectory(dir, STORAGE.thumbsFolderName);
    const thumbFiles = thumbsDir ? listFilesByName(thumbsDir) : null;

    const photos: Consultation["photos"] = [];
    const photoUris: string[] = [];
    const thumbUris: (string | null)[] = [];

    for (const entry of persisted.photos) {
        const file = files.get(entry.file);
        if (!file) continue;
        photos.push(entry);
        photoUris.push(file.uri);
        thumbUris.push(
            entry.thumb ? (thumbFiles?.get(thumbFileName(entry.thumb))?.uri ?? null) : null,
        );
    }

    return { ...persisted, photos, photoUris, thumbUris };
};

export const readConsultationAsync = async (dir: Directory): Promise<Consultation | null> => {
    const persisted = await readConsultationRecordAsync(dir);
    return persisted ? resolveConsultation(dir, persisted) : null;
};

/**
 * Whether a folder name is one of this app's temp/staging directories (import swaps,
 * collision renames). Indexers and importers must skip them; ID validation forbids `~`
 * in EMRs/CIDs precisely so these can never collide with a real record.
 */
export const isTempFolderName = (name: string): boolean => name.includes("~");

/**
 * `<oldEmr>-<oldCid>-NN.ext` → `<newEmr>-<newCid>-NN.ext`; names that don't follow the
 * scheme pass through unchanged. Used wherever a consultation or patient is renamed
 * (import CID collisions, sync renumbering) so photo file names stay self-describing.
 */
export const renamePhotoFileName = (
    name: string,
    oldEmr: string,
    oldCid: string,
    newEmr: string,
    newCid: string,
): string => {
    const prefix = `${oldEmr}-${oldCid}-`;
    return name.startsWith(prefix) ? `${newEmr}-${newCid}-${name.slice(prefix.length)}` : name;
};
