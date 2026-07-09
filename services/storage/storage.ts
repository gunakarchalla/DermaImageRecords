import { File, type Directory } from "expo-file-system";

import { IMAGE_FORMATS, IMAGE_FORMAT_KEYS } from "../../constants/preferences";
import { STORAGE } from "../../constants/storage";
import type { Consultation, ConsultationInput, Patient, PatientInput } from "../../types/models";
import { consultationIndexService } from "../indexing/consultationIndexService";
import { patientIndexService } from "../indexing/patientIndexService";
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

export const savePatient = async (patientId: string | null, input: PatientInput): Promise<Patient> => {
    await initStorage();

    const id = patientId ?? generateId();
    const dir = await getOrCreatePatientDirAsync(id);

    const now = new Date().toISOString();
    const existing = (await readJsonFromDir<Patient>(dir, STORAGE.patientFileName)) ?? null;

    const patient: Patient = {
        id,
        name: input.name.trim(),
        emrNumber: input.emrNumber?.trim() || undefined,
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
    // Overwrite profile photo only when user selected a new image.
    // Reprocessing the previously persisted SAF URI can fail on Android.
        const saved = await savePhotoToDirAsync(input.profilePhotoUri, dir, STORAGE.profilePhotoBaseName);
        await deleteStaleProfilePhotosAsync(dir, saved.fileName);
        patient.profilePhotoUri = saved.uri;
    }

    await writeJsonToDir(dir, STORAGE.patientFileName, patient);

    // Update index.
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
    const dir = getExistingConsultationDir(patientId, consultationId);
    if (dir) {
        // Best-effort validation read (source-of-truth is directory presence).
        void (await readJsonFromDir<Consultation>(dir, STORAGE.consultationFileName));
        await safeDeleteDir(dir);
    }

    // Always keep SQLite index in sync, even when the folder is already gone.
    await consultationIndexService.deleteConsultationAsync(patientId, consultationId);

    // Deleting a consultation is a patient record mutation; keep patient metadata/index in sync.
    const patientDir = getExistingPatientDir(patientId);
    const patient = patientDir ? await readJsonFromDir<Patient>(patientDir, STORAGE.patientFileName) : null;
    if (patient && patientDir) {
        patient.updatedAt = new Date().toISOString();
        await writeJsonToDir(patientDir, STORAGE.patientFileName, patient);
        await patientIndexService.upsertPatientAsync(patient);
    }
};

export const saveConsultation = async (
    patientId: string,
    consultationId: string | null,
    input: ConsultationInput
): Promise<Consultation> => {
    await initStorage();

    const id = consultationId ?? generateId();
    const patientDirectory = await getOrCreatePatientDirAsync(patientId);
    const consultationsDir = await getOrCreateConsultationsRootDirAsync(patientDirectory);
    const dir = await getOrCreateChildDirectoryAsync(consultationsDir, id);

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
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
    };

    await writeJsonToDir(dir, STORAGE.consultationFileName, consultation);

    // Keep patient metadata in sync for sorting by last modified.
    const existingPatientDirectory = getExistingPatientDir(patientId);
    const patient = existingPatientDirectory ? await readJsonFromDir<Patient>(existingPatientDirectory, STORAGE.patientFileName) : null;
    if (patient && existingPatientDirectory) {
        patient.updatedAt = now;
        await writeJsonToDir(existingPatientDirectory, STORAGE.patientFileName, patient);
        await patientIndexService.upsertPatientAsync(patient);
    }

    // Update index.
    await consultationIndexService.upsertConsultationAsync(consultation);

    return consultation;
};
