import * as FileSystem from "expo-file-system";
import * as ImageManipulator from "expo-image-manipulator";
import { Consultation, ConsultationInput, Patient, PatientInput } from "../types/models";

const PATIENTS_ROOT = `${FileSystem.documentDirectory}patients`;
const PATIENT_FILE = "patient.json";
const PROFILE_PHOTO = "profile.jpg";
const CONSULTATIONS_DIR = "consultations";
const CONSULTATION_FILE = "consultation.json";

const MAX_IMAGE_DIMENSION = 1280;
const IMAGE_QUALITY = 0.7;

const generateId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

const ensureDirAsync = async (dir: string) => {
    const info = await FileSystem.getInfoAsync(dir);
    if (!info.exists) {
        await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
    }
};

const patientDir = (patientId: string) => `${PATIENTS_ROOT}/${patientId}`;
const patientFile = (patientId: string) => `${patientDir(patientId)}/${PATIENT_FILE}`;
const profilePhotoFile = (patientId: string) => `${patientDir(patientId)}/${PROFILE_PHOTO}`;
const consultationDir = (patientId: string, consultationId: string) => `${patientDir(patientId)}/${CONSULTATIONS_DIR}/${consultationId}`;
const consultationFile = (patientId: string, consultationId: string) => `${consultationDir(patientId, consultationId)}/${CONSULTATION_FILE}`;

const readJson = async <T>(path: string): Promise<T | null> => {
    try {
        const content = await FileSystem.readAsStringAsync(path);
        return JSON.parse(content) as T;
    } catch (error) {
        return null;
    }
};

const writeJson = async (path: string, data: unknown) => {
    await FileSystem.writeAsStringAsync(path, JSON.stringify(data, null, 2));
};

const compressAndSaveImage = async (sourceUri: string, destinationUri: string) => {
    // Resize and compress photos before persisting to reduce storage usage and improve load speed.

    let manipulator = await ImageManipulator.ImageManipulator.manipulate(sourceUri);
    manipulator.resize({ width: MAX_IMAGE_DIMENSION, height: MAX_IMAGE_DIMENSION });
    manipulator = ImageManipulator.ImageManipulator.compress(manipulator, IMAGE_QUALITY);
    const imageRef = await manipulator.renderAsync();
    const result = await imageRef.saveAsync({ format: ImageManipulator.SaveFormat.JPEG });

    await FileSystem.copyAsync({ from: result.uri, to: destinationUri });
    return destinationUri;
};

export const initStorage = async () => {
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

    return patients;
};

export const getPatient = async (patientId: string): Promise<Patient | null> => {
    return readJson<Patient>(patientFile(patientId));
};

export const deletePatient = async (patientId: string) => {
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
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
    };

    if (input.profilePhotoUri) {
        const dest = profilePhotoFile(id);
        patient.profilePhotoUri = await compressAndSaveImage(input.profilePhotoUri, dest);
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

    return consultations;
};

export const getConsultation = async (
    patientId: string,
    consultationId: string
): Promise<Consultation | null> => {
    return readJson<Consultation>(consultationFile(patientId, consultationId));
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

    const consultation: Consultation = {
        id,
        patientId,
        remarks: input.remarks.trim(),
        photoUris: [],
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
    };

    // Clear old photos when updating to prevent orphaned files.
    if (existing?.photoUris?.length) {
        for (const photo of existing.photoUris) {
            await FileSystem.deleteAsync(photo, { idempotent: true });
        }
    }

    for (const uri of input.photoUris) {
        const fileName = `${generateId()}.jpg`;
        const dest = `${dir}/${fileName}`;
        const saved = await compressAndSaveImage(uri, dest);
        consultation.photoUris.push(saved);
    }

    await writeJson(consultationFile(patientId, id), consultation);

    // Keep patient metadata in sync for sorting by last modified.
    const patient = await readJson<Patient>(patientFile(patientId));
    if (patient) {
        patient.updatedAt = now;
        await writeJson(patientFile(patientId), patient);
    }

    return consultation;
};
