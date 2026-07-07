import { Directory, Paths } from "expo-file-system";

import { STORAGE } from "../../../constants/storage";
import { ensureDirAsync } from "../fsUtils";
import type { StorageDriver } from "./types";

const getSandboxRoot = () => new Directory(Paths.document, STORAGE.externalRootFolderName);

export const iosSandboxDriver: StorageDriver = {
    supportsFolderSelection: false,

    getDatasetRootDirectoryAsync: async () => {
        const root = getSandboxRoot();
        await ensureDirAsync(root);
        return root;
    },

    getPersistedRootUriAsync: async () => getSandboxRoot().uri,

    changeRootDirectoryAsync: async () => {
        // iOS keeps data in the app sandbox; there is no user-selectable location.
        throw new Error("Changing the storage folder isn't supported on this platform.");
    },

    clearPersistedRootAsync: async () => {
        // Fixed location — nothing to forget.
    },
};
