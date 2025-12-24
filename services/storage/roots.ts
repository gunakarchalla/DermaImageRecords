import { Directory, Paths } from "expo-file-system";

import { STORAGE } from "../../constants/storage";
import { getStorageDriver } from "./drivers";
import {
    ensureDirAsync,
    findChildDirectory,
    getOrCreateChildDirectoryAsync,
} from "./fsUtils";

let DATASET_ROOT_DIR: Directory | null = null;
let PATIENTS_ROOT_DIR: Directory | null = null;

const requireRootsAsync = async () => {
    if (DATASET_ROOT_DIR && PATIENTS_ROOT_DIR) return;

    const driver = getStorageDriver();
    const root = await driver.getDatasetRootDirectoryAsync();
    await ensureDirAsync(root);

    const patientsRoot = await getOrCreateChildDirectoryAsync(root, STORAGE.patientsFolderName);

    DATASET_ROOT_DIR = root;
    PATIENTS_ROOT_DIR = patientsRoot;
};

export const initStorageAsync = async () => {
    await requireRootsAsync();
};

export const getDatasetRootDirectoryAsync = async (): Promise<Directory> => {
    await requireRootsAsync();
    return DATASET_ROOT_DIR!;
};

export const getPatientsRootDirectoryAsync = async (): Promise<Directory> => {
    await requireRootsAsync();
    return PATIENTS_ROOT_DIR!;
};

export const getExistingPatientDir = (patientId: string): Directory | null => {
    if (!PATIENTS_ROOT_DIR) {
        throw new Error("Storage not initialized.");
    }
    // Read/list/delete MUST NOT recreate folders.
    return findChildDirectory(PATIENTS_ROOT_DIR, patientId);
};

export const getOrCreatePatientDirAsync = async (patientId: string): Promise<Directory> => {
    await requireRootsAsync();
    return getOrCreateChildDirectoryAsync(PATIENTS_ROOT_DIR!, patientId);
};

export const getExistingConsultationsRootDir = (patientDirectory: Directory): Directory | null => {
    return findChildDirectory(patientDirectory, STORAGE.consultationsFolderName);
};

export const getOrCreateConsultationsRootDirAsync = async (patientDirectory: Directory): Promise<Directory> => {
    return getOrCreateChildDirectoryAsync(patientDirectory, STORAGE.consultationsFolderName);
};

export const getExistingConsultationDir = (patientId: string, consultationId: string): Directory | null => {
    const patientDirectory = getExistingPatientDir(patientId);
    if (!patientDirectory) return null;
    const consultationsDirectory = getExistingConsultationsRootDir(patientDirectory);
    if (!consultationsDirectory) return null;
    return findChildDirectory(consultationsDirectory, consultationId);
};

export const getExistingConsultationsRootDirForPatientAsync = async (patientId: string): Promise<Directory | null> => {
    await requireRootsAsync();
    const patientDirectory = getExistingPatientDir(patientId);
    if (!patientDirectory) return null;
    return getExistingConsultationsRootDir(patientDirectory);
};

// Convenience for iOS sandbox paths (kept for parity with Android SAF).
export const getAppDocumentsDirectory = () => new Directory(Paths.document);
