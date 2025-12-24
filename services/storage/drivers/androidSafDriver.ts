import { Directory, File, Paths } from "expo-file-system";

import { STORAGE } from "../../../constants/storage";
import { ensureDirAsync, getOrCreateChildDirectoryAsync } from "../fsUtils";
import type { StorageDriver } from "./types";

const STORAGE_ROOT_CONFIG_FILE = new File(Paths.document, STORAGE.storageRootConfigFileName);

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

export const androidSafDriver: StorageDriver = {
    getDatasetRootDirectoryAsync: async () => {
        // 1) Try previously-selected root.
        const savedUri = await readStorageRootFromConfig();
        if (savedUri) {
            const saved = new Directory(savedUri);
            // If permission was revoked or folder deleted, `.exists` should be false.
            if (saved.exists) {
                return saved;
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
            picked.name === STORAGE.externalRootFolderName
                ? picked
                : await getOrCreateChildDirectoryAsync(picked, STORAGE.externalRootFolderName);

        await ensureDirAsync(root);
        await writeStorageRootToConfig(root.uri);

        return root;
    },
};
