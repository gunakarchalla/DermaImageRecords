import { Directory, File, Paths } from "expo-file-system";
import * as ImageManipulator from "expo-image-manipulator";
import { Consultation, ConsultationInput, Patient, PatientInput } from "../types/models";

// NOTE: Expo SDK 54+ deprecated `expo-file-system` legacy async functions.
// This module uses the newer `File`/`Directory`/`Paths` API from the latest docs.
//
// Source-of-truth requirement:
// - The entire dataset (folders, JSON, and images) must live under /Pictures/DermaImageRecords
//   as seen by third-party file explorers.
// - On Android, writing to a public directory requires user-granted access (SAF).
//   We prompt once to pick the Pictures directory (or DermaImageRecords itself) and then
//   persist the chosen URI in a tiny local config file (configuration, not data).
let APP_ROOT_DIR: Directory | null = null;
let PATIENTS_ROOT_DIR: Directory | null = null;

const STORAGE_ROOT_CONFIG_FILE = new File(Paths.document, "DermaImageRecords.storage-root.json");
const PATIENT_FILE = "patient.json";
const PROFILE_PHOTO = "profile.jpg";
const CONSULTATIONS_DIR = "consultations";
const CONSULTATION_FILE = "consultation.json";
const EXTERNAL_ROOT_FOLDER_NAME = "DermaImageRecords";

const MAX_IMAGE_DIMENSION = 1280;
const IMAGE_QUALITY = 0.7;

const generateId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

const ensureDirAsync = async (dir: Directory) => {
    // Create directory tree if missing.
    // Using `idempotent: true` makes repeated calls safe.
    dir.create({ intermediates: true, idempotent: true });
};

const listEntriesSafe = (dir: Directory): (Directory | File)[] => {
    try {
        if (!dir.exists) return [];
        return dir.list();
    } catch {
        return [];
    }
};

const findChildDirectory = (parent: Directory, name: string): Directory | null => {
    const entry = listEntriesSafe(parent).find((item) => item instanceof Directory && item.name === name);
    return (entry as Directory | undefined) ?? null;
};

const findChildFile = (parent: Directory, name: string): File | null => {
    const entry = listEntriesSafe(parent).find((item) => item instanceof File && item.name === name);
    return (entry as File | undefined) ?? null;
};

const getOrCreateChildDirectoryAsync = async (parent: Directory, name: string): Promise<Directory> => {
    await ensureDirAsync(parent);

    // IMPORTANT (SAF/content URIs): some document providers allow multiple folders with the same
    // display name under the same parent. If we call `createDirectory(name)` blindly, it may
    // succeed and create a *second* folder with the same name. Always prefer an existing child.
    const existing = findChildDirectory(parent, name);
    if (existing) return existing;

    try {
        const created = parent.createDirectory(name);
        await ensureDirAsync(created);
        return created;
    } catch {
        const existingAfterError = findChildDirectory(parent, name);
        if (existingAfterError) return existingAfterError;
        throw new Error(`Failed to access directory '${name}'.`);
    }
};

const replaceFileInDirectoryAsync = async (parent: Directory, name: string, mimeType: string | null): Promise<File> => {
    await ensureDirAsync(parent);

    const existing = findChildFile(parent, name);
    if (existing) {
        try {
            existing.delete();
        } catch {
            // Best-effort; we will attempt to create a fresh file below.
        }
    }

    // createFile will throw if a file with the same name exists.
    // If that happens (race), list and return it.
    try {
        return parent.createFile(name, mimeType);
    } catch {
        const stillThere = findChildFile(parent, name);
        if (stillThere) return stillThere;
        throw new Error(`Failed to create file '${name}'.`);
    }
};

const readStorageRootFromConfig = async (): Promise<string | null> => {
    try {
        if (!STORAGE_ROOT_CONFIG_FILE.exists) return null;
        const raw = await STORAGE_ROOT_CONFIG_FILE.text();
        const parsed = JSON.parse(raw) as { rootUri?: string };
        return parsed.rootUri ?? null;
    } catch {
        return null;
    }
};

const writeStorageRootToConfig = async (rootUri: string) => {
    STORAGE_ROOT_CONFIG_FILE.create({ intermediates: true, overwrite: true });
    STORAGE_ROOT_CONFIG_FILE.write(JSON.stringify({ rootUri }, null, 2));
};

const resolveAndEnsureExternalRootAsync = async () => {
    // 1) Try previously-selected root.
    const savedUri = await readStorageRootFromConfig();
    if (savedUri) {
        const saved = new Directory(savedUri);
        // If permission was revoked or folder deleted, `.exists` should be false.
        if (saved.exists) {
            APP_ROOT_DIR = saved;
            PATIENTS_ROOT_DIR = await getOrCreateChildDirectoryAsync(saved, "patients");
            return;
        }
    }

    // 2) Prompt user to pick a directory (Android: SAF).
    // Recommend picking "Pictures" so we can create /Pictures/DermaImageRecords.
    let pickedBase: Awaited<ReturnType<typeof Directory.pickDirectoryAsync>>;
    try {
        pickedBase = await Directory.pickDirectoryAsync();
    } catch {
        throw new Error("Storage location not selected.");
    }

    // `pickDirectoryAsync` returns a Directory instance from the underlying native module type.
    // Wrap it into the exported `Directory` class so we can use helpers like `.name`.
    const picked = new Directory(pickedBase.uri);

    // If the user picked Pictures (or anything else), ensure a DermaImageRecords folder exists inside.
    const root =
        picked.name === EXTERNAL_ROOT_FOLDER_NAME
            ? picked
            : await getOrCreateChildDirectoryAsync(picked, EXTERNAL_ROOT_FOLDER_NAME);

    await ensureDirAsync(root);

    APP_ROOT_DIR = root;
    PATIENTS_ROOT_DIR = await getOrCreateChildDirectoryAsync(root, "patients");

    await writeStorageRootToConfig(root.uri);
};

const requireRoots = async () => {
    if (APP_ROOT_DIR && PATIENTS_ROOT_DIR) return;
    await resolveAndEnsureExternalRootAsync();
};

const getExistingPatientDir = (patientId: string): Directory | null => {
    if (!PATIENTS_ROOT_DIR) {
        throw new Error("Storage not initialized.");
    }
    // Read/list/delete MUST NOT recreate folders. If a folder was removed externally,
    // it should disappear from the app on next load.
    return findChildDirectory(PATIENTS_ROOT_DIR, patientId);
};

const getOrCreatePatientDirAsync = async (patientId: string): Promise<Directory> => {
    if (!PATIENTS_ROOT_DIR) {
        throw new Error("Storage not initialized.");
    }
    return getOrCreateChildDirectoryAsync(PATIENTS_ROOT_DIR, patientId);
};

const getExistingConsultationsRootDir = (patientDirectory: Directory): Directory | null => {
    return findChildDirectory(patientDirectory, CONSULTATIONS_DIR);
};

const getOrCreateConsultationsRootDirAsync = async (patientDirectory: Directory): Promise<Directory> => {
    return getOrCreateChildDirectoryAsync(patientDirectory, CONSULTATIONS_DIR);
};

const getExistingConsultationDir = (patientId: string, consultationId: string): Directory | null => {
    const patientDirectory = getExistingPatientDir(patientId);
    if (!patientDirectory) return null;
    const consultationsDirectory = getExistingConsultationsRootDir(patientDirectory);
    if (!consultationsDirectory) return null;
    return findChildDirectory(consultationsDirectory, consultationId);
};

const safeDeleteFile = async (fileOrUri: File | string) => {
    const file = typeof fileOrUri === "string" ? new File(fileOrUri) : fileOrUri;
    try {
        file.delete();
    } catch {
        // Best-effort cleanup; missing files or permission issues should not crash the app.
    }
};

const safeDeleteDir = async (dir: Directory) => {
    try {
        dir.delete();
    } catch {
        // Best-effort cleanup.
    }
};

const readJsonFromDir = async <T>(dir: Directory, name: string): Promise<T | null> => {
    const file = findChildFile(dir, name);
    if (!file || !file.exists) return null;

    try {
        const content = await file.text();
        return JSON.parse(content) as T;
    } catch (error) {
        console.error(`Failed to read JSON from ${file.uri}:`, error);
        return null;
    }
};

const writeJsonToDir = async (dir: Directory, name: string, data: unknown) => {
    const file = await replaceFileInDirectoryAsync(dir, name, "application/json");
    file.write(JSON.stringify(data, null, 2));
};

const saveImageToExternalRoot = async (sourceUri: string, destination: File) => {
    // Resize and compress photos before persisting to reduce storage usage and improve load speed.
    const result = await ImageManipulator.manipulateAsync(
        sourceUri,
        [{ resize: { width: MAX_IMAGE_DIMENSION, height: MAX_IMAGE_DIMENSION } }],
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
    await requireRoots();
};

export const listPatients = async (): Promise<Patient[]> => {
    await initStorage();
    if (!PATIENTS_ROOT_DIR) return [];
    const folders = PATIENTS_ROOT_DIR.list().filter((entry) => entry instanceof Directory) as Directory[];
    const patients: Patient[] = [];

    for (const folder of folders) {
        const data = await readJsonFromDir<Patient>(folder, PATIENT_FILE);
        if (data) {
            patients.push(data);
        }
    }

    return patients.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
};

export const getPatient = async (patientId: string): Promise<Patient | null> => {
    await initStorage();
    const dir = getExistingPatientDir(patientId);
    if (!dir) return null;
    return readJsonFromDir<Patient>(dir, PATIENT_FILE);
};

export const deletePatient = async (patientId: string) => {
    await initStorage();
    const dir = findChildDirectory(PATIENTS_ROOT_DIR!, patientId);
    if (!dir) return;

    const patient = await readJsonFromDir<Patient>(dir, PATIENT_FILE);
    const consultations = await listConsultations(patientId);

    // `patient` and `consultations` are read to validate existence; deletion is purely directory-based.
    // The file system (external folder hierarchy) is the only source of truth.
    void patient;
    void consultations;

    await safeDeleteDir(dir);
};

export const savePatient = async (
    patientId: string | null,
    input: PatientInput
): Promise<Patient> => {
    await initStorage();

    const id = patientId ?? generateId();
    const dir = await getOrCreatePatientDirAsync(id);

    const now = new Date().toISOString();
    const existing = (await readJsonFromDir<Patient>(dir, PATIENT_FILE)) ?? null;

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
        // We must create the destination via SAF to get a valid content URI.
        const dest = await replaceFileInDirectoryAsync(dir, PROFILE_PHOTO, "image/jpeg");
        const saved = await saveImageToExternalRoot(input.profilePhotoUri, dest);
        patient.profilePhotoUri = saved.uri;
    }

    await writeJsonToDir(dir, PATIENT_FILE, patient);
    return patient;
};

export const listConsultations = async (patientId: string): Promise<Consultation[]> => {
    await initStorage();
    const patientDirectory = getExistingPatientDir(patientId);
    if (!patientDirectory) return [];
    const consDir = getExistingConsultationsRootDir(patientDirectory);
    if (!consDir || !consDir.exists) return [];

    const folders = consDir.list().filter((entry) => entry instanceof Directory) as Directory[];
    const consultations: Consultation[] = [];

    for (const folder of folders) {
        const data = await readJsonFromDir<Consultation>(folder, CONSULTATION_FILE);
        if (data) consultations.push(data);
    }

    return consultations.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
};

export const getConsultation = async (
    patientId: string,
    consultationId: string
): Promise<Consultation | null> => {
    await initStorage();
    const dir = getExistingConsultationDir(patientId, consultationId);
    if (!dir) return null;
    return readJsonFromDir<Consultation>(dir, CONSULTATION_FILE);
};

export const deleteConsultation = async (patientId: string, consultationId: string) => {
    await initStorage();
    const dir = getExistingConsultationDir(patientId, consultationId);
    if (!dir) return;

    const existing = await readJsonFromDir<Consultation>(dir, CONSULTATION_FILE);
    void existing;

    await safeDeleteDir(dir);
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
    const existing = (await readJsonFromDir<Consultation>(dir, CONSULTATION_FILE)) ?? null;

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

    await writeJsonToDir(dir, CONSULTATION_FILE, consultation);

    // Keep patient metadata in sync for sorting by last modified.
    const existingPatientDirectory = getExistingPatientDir(patientId);
    const patient = existingPatientDirectory ? await readJsonFromDir<Patient>(existingPatientDirectory, PATIENT_FILE) : null;
    if (patient && existingPatientDirectory) {
        patient.updatedAt = now;
        await writeJsonToDir(existingPatientDirectory, PATIENT_FILE, patient);
    }

    return consultation;
};
