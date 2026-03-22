import { File } from "expo-file-system";
import * as ImageManipulator from "expo-image-manipulator";

import { STORAGE } from "../../constants/storage";
import type { Consultation, ConsultationInput, Patient, PatientInput } from "../../types/models";
import { consultationIndexService } from "../indexing/consultationIndexService";
import { patientIndexService } from "../indexing/patientIndexService";
import {
    getOrCreateChildDirectoryAsync,
    readJsonFromDir,
    replaceFileInDirectoryAsync,
    safeDeleteDir,
    safeDeleteFile,
    writeJsonToDir,
} from "./fsUtils";
import {
    getExistingConsultationDir,
    getExistingPatientDir,
    getOrCreateConsultationsRootDirAsync,
    getOrCreatePatientDirAsync,
    initStorageAsync,
} from "./roots";

const IMAGE_QUALITY = 0.7;

const generateId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

const saveImageToExternalRoot = async (sourceUri: string, destination: File) => {
    // Compress photos before persisting to reduce storage usage while preserving original dimensions.
    const result = await ImageManipulator.manipulateAsync(
        sourceUri,
        [],
        { compress: IMAGE_QUALITY, format: ImageManipulator.SaveFormat.JPEG }
    );

    // Write bytes into the SAF-created destination file.
    // NOTE: We cannot reliably use File.copy() to SAF/content URIs.
    const src = new File(result.uri);
    const bytes = await src.bytes();
    destination.write(bytes);

    // No MediaLibrary duplication: this folder is the single source of truth.
    return { uri: destination.uri };
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

    if (input.profilePhotoUri) {
        // Always overwrite the single profile photo file in-place.
        const dest = await replaceFileInDirectoryAsync(dir, STORAGE.profilePhotoFileName, "image/jpeg");
        const saved = await saveImageToExternalRoot(input.profilePhotoUri, dest);
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

    // Keep files the user kept and delete removed ones.
    for (let index = 0; index < existingPhotoUris.length; index += 1) {
        const uri = existingPhotoUris[index];
        if (incomingUris.includes(uri)) {
            preservedUris.push(uri);
        } else {
            await safeDeleteFile(uri);
        }
    }

    // Save newly added photos.
    for (const uri of incomingUris) {
        if (preservedUris.includes(uri)) continue;
        const fileName = `${generateId()}.jpg`;
        const dest = await replaceFileInDirectoryAsync(dir, fileName, "image/jpeg");
        const saved = await saveImageToExternalRoot(uri, dest);
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
