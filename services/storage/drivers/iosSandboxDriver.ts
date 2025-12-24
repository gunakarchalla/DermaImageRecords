import { Directory, Paths } from "expo-file-system";

import { STORAGE } from "../../../constants/storage";
import { ensureDirAsync } from "../fsUtils";
import type { StorageDriver } from "./types";

export const iosSandboxDriver: StorageDriver = {
    getDatasetRootDirectoryAsync: async () => {
        const root = new Directory(Paths.document, STORAGE.externalRootFolderName);
        await ensureDirAsync(root);
        return root;
    },
};
