import { Directory } from "expo-file-system";

import { STORAGE } from "../../constants/storage";
import { getStorageDriver } from "./drivers";
import {
    ensureDirAsync,
    findChildDirectory,
    getOrCreateChildDirectoryAsync,
    listEntriesSafe,
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

/**
 * Drop the cached root directory singletons so the next access re-resolves them
 * from the driver. Call after changing the storage folder or wiping data.
 */
export const resetStorageRootsCache = () => {
    DATASET_ROOT_DIR = null;
    PATIENTS_ROOT_DIR = null;
};

export const getDatasetRootDirectoryAsync = async (): Promise<Directory> => {
    await requireRootsAsync();
    return DATASET_ROOT_DIR!;
};

export const getPatientsRootDirectoryAsync = async (): Promise<Directory> => {
    await requireRootsAsync();
    return PATIENTS_ROOT_DIR!;
};

/**
 * Whether any patient folder exists on disk, **without creating or prompting for anything**.
 *
 * The restore offer runs right after sign-in, before the user has necessarily picked a storage
 * folder — and `getPatientsRootDirectoryAsync` would open the SAF picker to answer this. So we
 * read the persisted root URI directly and treat "no folder chosen yet" as an empty dataset.
 */
export const hasAnyPatientsAsync = async (): Promise<boolean> => {
    const containsPatientFolder = (patientsDir: Directory): boolean =>
        listEntriesSafe(patientsDir).some((entry) => entry instanceof Directory);

    if (PATIENTS_ROOT_DIR) return containsPatientFolder(PATIENTS_ROOT_DIR);

    const rootUri = await getStorageDriver().getPersistedRootUriAsync();
    if (!rootUri) return false;

    const patientsDir = findChildDirectory(new Directory(rootUri), STORAGE.patientsFolderName);
    return patientsDir ? containsPatientFolder(patientsDir) : false;
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
