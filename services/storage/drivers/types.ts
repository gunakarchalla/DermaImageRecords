import type { Directory } from "expo-file-system";

export type StorageDriver = {
    /**
     * Returns the dataset root directory (DermaImageRecords).
     *
     * Android: SAF directory user picked / persisted (public Pictures)
     * iOS: app sandbox Documents/DermaImageRecords
     */
    getDatasetRootDirectoryAsync: () => Promise<Directory>;
};
