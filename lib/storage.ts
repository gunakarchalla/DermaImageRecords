import * as FileSystem from "expo-file-system";
import * as ImageManipulator from "expo-image-manipulator";
import * as MediaLibrary from "expo-media-library";
import { Consultation, ConsultationInput, Patient, PatientInput } from "../types/models";

const APP_ROOT = `${FileSystem.documentDirectory}DermaImageRecords`;
const PATIENTS_ROOT = `${APP_ROOT}/patients`;
const PATIENT_FILE = "patient.json";
const PROFILE_PHOTO = "profile.jpg";
const CONSULTATIONS_DIR = "consultations";
const CONSULTATION_FILE = "consultation.json";
const MEDIA_ALBUM_NAME = "DermaImageRecords";

const MAX_IMAGE_DIMENSION = 1280;
const IMAGE_QUALITY = 0.7;

const generateId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

const ensureDirAsync = async (dir: string) => {
    const info = await FileSystem.getInfoAsync(dir);
    if (!info.exists) {
        await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
    }
};

const ensureMediaPermissions = async () => {
    const current = await MediaLibrary.getPermissionsAsync();
    if (current.granted) return true;
    const requested = await MediaLibrary.requestPermissionsAsync();
    return requested.granted;
};

const deleteAssetSafely = async (assetId?: string | null) => {
    if (!assetId) return;
    try {
        await MediaLibrary.deleteAssetsAsync([assetId]);
    } catch (error) {
        console.warn("Failed to delete MediaLibrary asset", error);
    }
};

const patientDir = (patientId: string) => `${PATIENTS_ROOT}/${patientId}`;
const patientFile = (patientId: string) => `${patientDir(patientId)}/${PATIENT_FILE}`;
const profilePhotoFile = (patientId: string) => `${patientDir(patientId)}/${PROFILE_PHOTO}`;
const consultationDir = (patientId: string, consultationId: string) => `${patientDir(patientId)}/${CONSULTATIONS_DIR}/${consultationId}`;
const consultationFile = (patientId: string, consultationId: string) => `${consultationDir(patientId, consultationId)}/${CONSULTATION_FILE}`;

const readJson = async <T>(path: string): Promise<T | null> => {
    // Guard against missing files so callers do not hit ENOENT when the file was not yet created.
    const info = await FileSystem.getInfoAsync(path);
    if (!info.exists) {
        return null;
    }

    try {
        const content = await FileSystem.readAsStringAsync(path);
        return JSON.parse(content) as T;
    } catch (error) {
        console.error(`Failed to read JSON from ${path}:`, error);
        return null;
    }
};

const writeJson = async (path: string, data: unknown) => {
    await FileSystem.writeAsStringAsync(path, JSON.stringify(data, null, 2));
};

const saveImageWithAlbumCopy = async (sourceUri: string, destinationUri: string) => {
    // Resize and compress photos before persisting to reduce storage usage and improve load speed.
    const result = await ImageManipulator.manipulateAsync(
        sourceUri,
        [{ resize: { width: MAX_IMAGE_DIMENSION, height: MAX_IMAGE_DIMENSION } }],
        { compress: IMAGE_QUALITY, format: ImageManipulator.SaveFormat.JPEG }
    );

    await FileSystem.copyAsync({ from: result.uri, to: destinationUri });

    let assetId: string | null = null;
    try {
        if (await ensureMediaPermissions()) {
            const asset = await MediaLibrary.createAssetAsync(destinationUri);
            const album = await MediaLibrary.getAlbumAsync(MEDIA_ALBUM_NAME);
            if (album) {
                await MediaLibrary.addAssetsToAlbumAsync([asset], album, false);
            } else {
                await MediaLibrary.createAlbumAsync(MEDIA_ALBUM_NAME, asset, false);
            }
            assetId = asset.id;
        }
    } catch (error) {
        console.warn("Failed to copy image to MediaLibrary", error);
    }

    return { uri: destinationUri, assetId };
};

export const initStorage = async () => {
    await ensureDirAsync(APP_ROOT);
    await ensureDirAsync(PATIENTS_ROOT);
};

export const listPatients = async (): Promise<Patient[]> => {
    await initStorage();
    const folders = await FileSystem.readDirectoryAsync(PATIENTS_ROOT);
    const patients: Patient[] = [];

    for (const id of folders) {
        const data = await readJson<Patient>(patientFile(id));
        if (data) {
            patients.push(data);
        }
    }

    return patients.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
};

export const getPatient = async (patientId: string): Promise<Patient | null> => {
    return readJson<Patient>(patientFile(patientId));
};

export const deletePatient = async (patientId: string) => {
    const patient = await readJson<Patient>(patientFile(patientId));
    const consultations = await listConsultations(patientId);

    if (patient?.profilePhotoAssetId) {
        await deleteAssetSafely(patient.profilePhotoAssetId);
    }

    for (const consultation of consultations) {
        if (consultation.photoAssetIds?.length) {
            for (const assetId of consultation.photoAssetIds) {
                await deleteAssetSafely(assetId);
            }
        }
    }

    await FileSystem.deleteAsync(patientDir(patientId), { idempotent: true });
};

export const savePatient = async (
    patientId: string | null,
    input: PatientInput
): Promise<Patient> => {
    await initStorage();
    const id = patientId ?? generateId();
    const dir = patientDir(id);
    await ensureDirAsync(dir);

    const now = new Date().toISOString();
    const existing = (await readJson<Patient>(patientFile(id))) ?? null;

    const patient: Patient = {
        id,
        name: input.name.trim(),
        emrNumber: input.emrNumber?.trim() || undefined,
        age: input.age,
        gender: input.gender,
        phone: input.phone?.trim() || undefined,
        profilePhotoUri: existing?.profilePhotoUri,
        profilePhotoAssetId: existing?.profilePhotoAssetId ?? null,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
    };

    if (input.profilePhotoUri) {
        const dest = profilePhotoFile(id);

        if (existing?.profilePhotoUri && existing.profilePhotoUri !== dest) {
            await FileSystem.deleteAsync(existing.profilePhotoUri, { idempotent: true });
        }
        if (existing?.profilePhotoAssetId) {
            await deleteAssetSafely(existing.profilePhotoAssetId);
        }

        const saved = await saveImageWithAlbumCopy(input.profilePhotoUri, dest);
        patient.profilePhotoUri = saved.uri;
        patient.profilePhotoAssetId = saved.assetId;
    }

    await writeJson(patientFile(id), patient);
    return patient;
};

export const listConsultations = async (patientId: string): Promise<Consultation[]> => {
    const consDir = `${patientDir(patientId)}/${CONSULTATIONS_DIR}`;
    const info = await FileSystem.getInfoAsync(consDir);
    if (!info.exists) return [];

    const folders = await FileSystem.readDirectoryAsync(consDir);
    const consultations: Consultation[] = [];

    for (const id of folders) {
        const data = await readJson<Consultation>(consultationFile(patientId, id));
        if (data) consultations.push(data);
    }

    return consultations.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
};

export const getConsultation = async (
    patientId: string,
    consultationId: string
): Promise<Consultation | null> => {
    return readJson<Consultation>(consultationFile(patientId, consultationId));
};

export const deleteConsultation = async (patientId: string, consultationId: string) => {
    const existing = await readJson<Consultation>(consultationFile(patientId, consultationId));
    if (existing?.photoAssetIds?.length) {
        for (const assetId of existing.photoAssetIds) {
            await deleteAssetSafely(assetId);
        }
    }
    await FileSystem.deleteAsync(consultationDir(patientId, consultationId), { idempotent: true });
};

export const saveConsultation = async (
    patientId: string,
    consultationId: string | null,
    input: ConsultationInput
): Promise<Consultation> => {
    await initStorage();
    const id = consultationId ?? generateId();
    const dir = consultationDir(patientId, id);
    await ensureDirAsync(dir);

    const now = new Date().toISOString();
    const existing = (await readJson<Consultation>(consultationFile(patientId, id))) ?? null;

    const existingPhotoUris = existing?.photoUris ?? [];
    const existingPhotoAssetIds = existing?.photoAssetIds ?? [];
    const incomingUris = input.photoUris;

    const preservedUris: string[] = [];
    const preservedAssetIds: (string | null)[] = [];

    // Keep files the user kept and delete removed ones (including MediaLibrary assets).
    for (let index = 0; index < existingPhotoUris.length; index += 1) {
        const uri = existingPhotoUris[index];
        const assetId = existingPhotoAssetIds[index];
        if (incomingUris.includes(uri)) {
            preservedUris.push(uri);
            preservedAssetIds.push(assetId ?? null);
        } else {
            await FileSystem.deleteAsync(uri, { idempotent: true });
            await deleteAssetSafely(assetId);
        }
    }

    // Save newly added photos.
    for (const uri of incomingUris) {
        if (preservedUris.includes(uri)) continue;
        const fileName = `${generateId()}.jpg`;
        const dest = `${dir}/${fileName}`;
        const saved = await saveImageWithAlbumCopy(uri, dest);
        preservedUris.push(saved.uri);
        preservedAssetIds.push(saved.assetId ?? null);
    }

    const consultation: Consultation = {
        id,
        patientId,
        remarks: input.remarks.trim(),
        photoUris: preservedUris,
        photoAssetIds: preservedAssetIds,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
    };

    await writeJson(consultationFile(patientId, id), consultation);

    // Keep patient metadata in sync for sorting by last modified.
    const patient = await readJson<Patient>(patientFile(patientId));
    if (patient) {
        patient.updatedAt = now;
        await writeJson(patientFile(patientId), patient);
    }

    return consultation;
};
