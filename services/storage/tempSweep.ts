import { Directory, File, Paths } from "expo-file-system";

import { STORAGE } from "../../constants/storage";
import { listEntriesSafe } from "./fsUtils";

/**
 * Cold-start cleanup of cache temp files that escaped their normal lifecycle: captures
 * abandoned by a crash, ImageManipulator outputs from cancelled crops, aged render-cache
 * copies. Everything here is re-creatable, so deletion is always safe; age thresholds
 * keep recently-used entries (an open camera session, warm render caches) alive.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** expo-camera and expo-image-manipulator write their temps into these cache subfolders. */
const TEMP_DIR_SWEEPS: { name: string; maxAgeMs: number }[] = [
    { name: "Camera", maxAgeMs: 3 * DAY_MS },
    { name: "ImageManipulator", maxAgeMs: 3 * DAY_MS },
    // Render-safe copies re-create lazily on the next view; old fingerprints of mutated
    // sources are already deleted eagerly, so this only catches never-viewed leftovers.
    { name: STORAGE.imageCacheFolderName, maxAgeMs: 14 * DAY_MS },
];

const sweepDirectory = (dir: Directory, maxAgeMs: number, now: number) => {
    for (const entry of listEntriesSafe(dir)) {
        try {
            if (entry instanceof Directory) {
                sweepDirectory(entry, maxAgeMs, now);
                continue;
            }
            const modified = (entry as File).modificationTime;
            if (modified !== null && now - modified > maxAgeMs) {
                entry.delete();
            }
        } catch {
            // A single stubborn file must not stop the sweep.
        }
    }
};

/** Fire-and-forget; call once per cold start after the UI is up. */
export const sweepTempFilesAsync = async (): Promise<void> => {
    const now = Date.now();
    for (const { name, maxAgeMs } of TEMP_DIR_SWEEPS) {
        try {
            const dir = new Directory(Paths.cache, name);
            if (dir.exists) sweepDirectory(dir, maxAgeMs, now);
        } catch {
            // Best-effort.
        }
    }
};
