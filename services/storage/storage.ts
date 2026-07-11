import { File, type Directory } from "expo-file-system";

import { IMAGE_FORMATS, IMAGE_FORMAT_KEYS } from "../../constants/preferences";
import { STORAGE } from "../../constants/storage";
import type {
    Consultation,
    ConsultationInput,
    Patient,
    PatientCreateInput,
    PatientUpdateInput,
} from "../../types/models";
import { folderStampFromCreatedAt } from "../consultation/consultationNumber";
import { consultationIndexService } from "../indexing/consultationIndexService";
import { patientIndexService } from "../indexing/patientIndexService";
import { EmrNumberTakenError, requireValidEmrNumber } from "../patient/emr";
import {
    findChildFile,
    getOrCreateChildDirectoryAsync,
    readJsonFromDir,
    replaceFileInDirectoryAsync,
    safeDeleteDir,
    safeDeleteFile,
    writeJsonToDir,
} from "./fsUtils";
import { encodeImageForStorageAsync } from "./imageEncoding";
import {
    getExistingConsultationDir,
    getExistingPatientDir,
    getOrCreateConsultationsRootDirAsync,
    getOrCreatePatientDirAsync,
    initStorageAsync,
} from "./roots";

const generateId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

/**
 * Encode a photo per the user's image settings, then write it into `dir` as `<baseName>.<ext>`.
 * The extension follows the chosen format, so it can't be known before encoding.
 */
const savePhotoToDirAsync = async (sourceUri: string, dir: Directory, baseName: string) => {
    const encoded = await encodeImageForStorageAsync(sourceUri);
    const destination = await replaceFileInDirectoryAsync(dir, `${baseName}.${encoded.ext}`, encoded.mimeType);

    // Write bytes into the SAF-created destination file.
    // NOTE: We cannot reliably use File.copy() to SAF/content URIs.
    const src = new File(encoded.uri);
    const bytes = await src.bytes();
    destination.write(bytes);

    // No MediaLibrary duplication: this folder is the single source of truth.
    return { uri: destination.uri, fileName: destination.name };
};

/**
 * The profile photo has a fixed stem but a format-dependent extension, so switching format
 * would otherwise strand the previous `profile.<old-ext>` next to the new one.
 */
const deleteStaleProfilePhotosAsync = async (dir: Directory, keepFileName: string) => {
    for (const format of IMAGE_FORMAT_KEYS) {
        const name = `${STORAGE.profilePhotoBaseName}.${IMAGE_FORMATS[format].ext}`;
        if (name === keepFileName) continue;
        const stale = findChildFile(dir, name);
        if (stale) await safeDeleteFile(stale);
    }
};

export const initStorage = async () => {
    await initStorageAsync();
};

export const getPatient = async (patientId: string): Promise<Patient | null> => {
    await initStorage();
    const dir = getExistingPatientDir(patientId);
    if (!dir) return null;
    return readJsonFromDir<Patient>(dir, STORAGE.patientFileName);
};

export const deletePatient = async (patientId: string) => {
    await initStorage();
    const dir = getExistingPatientDir(patientId);

    // If the folder is missing (deleted externally), treat it as already deleted on disk.
    // The filesystem is the source-of-truth; the SQLite DB is rebuildable cache/index.
    if (dir) {
        // Best-effort validation reads (source-of-truth is directory presence).
        void (await readJsonFromDir<Patient>(dir, STORAGE.patientFileName));
        await safeDeleteDir(dir);
    }

    // Always keep SQLite index in sync, even when the folder is already gone.
    await patientIndexService.deletePatientAsync(patientId);
    await consultationIndexService.deleteConsultationsByPatientAsync(patientId);
};

/**
 * Write `sourceUri` as the patient's profile photo and clear any previous one left behind by a
 * different image-format setting. Only call when the user actually picked a new image:
 * reprocessing an already-persisted SAF URI can fail on Android.
 */
const writeProfilePhotoAsync = async (dir: Directory, sourceUri: string): Promise<string> => {
    const saved = await savePhotoToDirAsync(sourceUri, dir, STORAGE.profilePhotoBaseName);
    await deleteStaleProfilePhotosAsync(dir, saved.fileName);
    return saved.uri;
};

/**
 * Create a patient under the folder named by their EMR number.
 *
 * The EMR is the identity (see types/models.ts), so this is the only place one is ever assigned.
 * Uniqueness is checked against the disk rather than the index, and checked *before*
 * `getOrCreatePatientDirAsync` — that helper adopts an existing folder by design, which would
 * silently merge two patients onto one record.
 */
export const createPatientAsync = async (input: PatientCreateInput): Promise<Patient> => {
    await initStorage();

    const emrNumber = requireValidEmrNumber(input.emrNumber);

    const clash = getExistingPatientDir(emrNumber);
    if (clash) {
        const owner = await readJsonFromDir<Patient>(clash, STORAGE.patientFileName);
        throw new EmrNumberTakenError(emrNumber, owner?.name);
    }

    const dir = await getOrCreatePatientDirAsync(emrNumber);
    const now = new Date().toISOString();

    const patient: Patient = {
        id: emrNumber,
        emrNumber,
        name: input.name.trim(),
        age: input.age,
        gender: input.gender,
        phone: input.phone?.trim() || undefined,
        profilePhotoUri: undefined,
        createdAt: now,
        updatedAt: now,
    };

    if (input.profilePhotoUri) {
        patient.profilePhotoUri = await writeProfilePhotoAsync(dir, input.profilePhotoUri);
    }

    await writeJsonToDir(dir, STORAGE.patientFileName, patient);
    await patientIndexService.upsertPatientAsync(patient);

    return patient;
};

/**
 * Update a patient's details. The EMR cannot change — `PatientUpdateInput` has no such field,
 * and identity is re-derived from the folder we found rather than from anything the caller passed.
 */
export const updatePatientAsync = async (patientId: string, input: PatientUpdateInput): Promise<Patient> => {
    await initStorage();

    const dir = getExistingPatientDir(patientId);
    if (!dir) throw new Error("That patient no longer exists on this device.");

    const existing = await readJsonFromDir<Patient>(dir, STORAGE.patientFileName);
    const now = new Date().toISOString();

    const patient: Patient = {
        id: patientId,
        emrNumber: patientId,
        name: input.name.trim(),
        age: input.age,
        gender: input.gender,
        phone: input.phone?.trim() || undefined,
        profilePhotoUri: existing?.profilePhotoUri,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
    };

    const hasNewProfilePhoto = Boolean(
        input.profilePhotoUri && input.profilePhotoUri !== existing?.profilePhotoUri
    );

    if (hasNewProfilePhoto && input.profilePhotoUri) {
        patient.profilePhotoUri = await writeProfilePhotoAsync(dir, input.profilePhotoUri);
    }

    await writeJsonToDir(dir, STORAGE.patientFileName, patient);
    await patientIndexService.upsertPatientAsync(patient);

    return patient;
};

export const getConsultation = async (patientId: string, consultationId: string): Promise<Consultation | null> => {
    await initStorage();
    const dir = getExistingConsultationDir(patientId, consultationId);
    if (!dir) return null;
    return readJsonFromDir<Consultation>(dir, STORAGE.consultationFileName);
};

export const deleteConsultation = async (patientId: string, consultationId: string) => {
    await initStorage();

    const patientDir = getExistingPatientDir(patientId);

    const dir = getExistingConsultationDir(patientId, consultationId);
    if (dir) {
        // Best-effort validation read (source-of-truth is directory presence).
        void (await readJsonFromDir<Consultation>(dir, STORAGE.consultationFileName));
        await safeDeleteDir(dir);
    }

    // Always keep SQLite index in sync, even when the folder is already gone.
    await consultationIndexService.deleteConsultationAsync(patientId, consultationId);

    // Deleting a consultation is a patient record mutation; keep patient metadata/index in sync.
    // The visit number is derived from `createdAt` order, so the remaining visits simply re-label
    // themselves — there is no counter to maintain.
    const patient = patientDir ? await readJsonFromDir<Patient>(patientDir, STORAGE.patientFileName) : null;
    if (patient && patientDir) {
        patient.updatedAt = new Date().toISOString();
        await writeJsonToDir(patientDir, STORAGE.patientFileName, patient);
        await patientIndexService.upsertPatientAsync(patient);
    }
};

/**
 * Allocate a fresh id + `createdAt` for a new consultation. The id is the `createdAt`-derived
 * timestamp stamp (see services/consultation/consultationNumber.ts). Creation is sequential, so a
 * collision is only possible in the same millisecond — bump by 1 ms until the folder name is free,
 * preserving the `id === folderStampFromCreatedAt(createdAt)` invariant and keeping folders unique.
 */
const allocateConsultationStamp = (patientId: string): { id: string; createdAt: string } => {
    let ms = Date.now();
    for (;;) {
        const createdAt = new Date(ms).toISOString();
        const id = folderStampFromCreatedAt(createdAt);
        if (!getExistingConsultationDir(patientId, id)) return { id, createdAt };
        ms += 1;
    }
};

export const saveConsultation = async (
    patientId: string,
    consultationId: string | null,
    input: ConsultationInput
): Promise<Consultation> => {
    await initStorage();

    // Never create the patient folder from here: `patientId` is the EMR, and a stale route
    // param would otherwise materialise an empty patient that owns that EMR forever.
    const patientDirectory = getExistingPatientDir(patientId);
    if (!patientDirectory) throw new Error("That patient no longer exists on this device.");

    const patient = await readJsonFromDir<Patient>(patientDirectory, STORAGE.patientFileName);
    const consultationsDir = await getOrCreateConsultationsRootDirAsync(patientDirectory);

    // Creating mints a fresh timestamp id; editing keeps the folder the id already names.
    // The folder name is the identity, so an edit must never conjure a new folder.
    let dir: Directory;
    let id: string;
    let createdAtForNew: string;

    if (consultationId === null) {
        const allocated = allocateConsultationStamp(patientId);
        id = allocated.id;
        createdAtForNew = allocated.createdAt;
        dir = await getOrCreateChildDirectoryAsync(consultationsDir, id);
    } else {
        const found = getExistingConsultationDir(patientId, consultationId);
        if (!found) throw new Error("That consultation no longer exists on this device.");
        dir = found;
        id = consultationId;
        createdAtForNew = new Date().toISOString(); // fallback only, if the file is somehow missing
    }

    const now = new Date().toISOString();
    const existing = (await readJsonFromDir<Consultation>(dir, STORAGE.consultationFileName)) ?? null;

    const existingPhotoUris = existing?.photoUris ?? [];
    const incomingUris = input.photoUris;

    const preservedUris: string[] = [];
    const existingSet = new Set(existingPhotoUris);
    const incomingSet = new Set(incomingUris);

    // Delete files that were removed by the user.
    for (let index = 0; index < existingPhotoUris.length; index += 1) {
        const uri = existingPhotoUris[index];
        if (!incomingSet.has(uri)) {
            await safeDeleteFile(uri);
        }
    }

    // Rebuild in incoming order so edited photos stay at the same position.
    for (const uri of incomingUris) {
        if (preservedUris.includes(uri)) continue;

        if (existingSet.has(uri)) {
            preservedUris.push(uri);
            continue;
        }

        const saved = await savePhotoToDirAsync(uri, dir, generateId());
        preservedUris.push(saved.uri);
    }

    const consultation: Consultation = {
        id,
        patientId,
        remarks: input.remarks.trim(),
        photoUris: preservedUris,
        createdAt: existing?.createdAt ?? createdAtForNew,
        updatedAt: now,
    };

    await writeJsonToDir(dir, STORAGE.consultationFileName, consultation);

    // Keep patient metadata in sync for sorting by last modified. The visit number is derived from
    // `createdAt` order, so there is no counter to advance here.
    if (patient) {
        patient.updatedAt = now;
        await writeJsonToDir(patientDirectory, STORAGE.patientFileName, patient);
        await patientIndexService.upsertPatientAsync(patient);
    }

    // Update index.
    await consultationIndexService.upsertConsultationAsync(consultation);

    return consultation;
};
