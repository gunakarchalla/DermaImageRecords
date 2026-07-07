import type { Directory } from "expo-file-system";

export type StorageDriver = {
    /**
     * Returns the dataset root directory (DermaImageRecords).
     *
     * Android: SAF directory user picked / persisted (public Pictures)
     * iOS: app sandbox Documents/DermaImageRecords
     */
    getDatasetRootDirectoryAsync: () => Promise<Directory>;

    /**
     * Whether the user can re-pick the storage location.
     * Android (SAF) can; iOS uses a fixed sandbox folder.
     */
    readonly supportsFolderSelection: boolean;

    /**
     * The currently-persisted root URI without prompting, or null if none is set.
     * On fixed-location platforms this resolves the sandbox folder URI.
     */
    getPersistedRootUriAsync: () => Promise<string | null>;

    /**
     * Prompt the user to pick a new dataset folder and persist it.
     * Throws if the platform doesn't support selection or the user cancels.
     */
    changeRootDirectoryAsync: () => Promise<Directory>;

    /**
     * Forget the persisted root so the next access re-prompts.
     * No-op on fixed-location platforms.
     */
    clearPersistedRootAsync: () => Promise<void>;
};
