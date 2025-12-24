import { Platform } from "react-native";

import { androidSafDriver } from "./androidSafDriver";
import { iosSandboxDriver } from "./iosSandboxDriver";
import type { StorageDriver } from "./types";

export const getStorageDriver = (): StorageDriver => {
    if (Platform.OS === "android") return androidSafDriver;
    return iosSandboxDriver;
};
