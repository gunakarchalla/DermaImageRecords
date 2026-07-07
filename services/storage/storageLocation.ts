import { clearImageCacheAsync } from "../imageUri";
import { patientIndexService } from "../indexing/patientIndexService";
import { dermaDb } from "../db/dermaDb";
import { getStorageDriver } from "./drivers";
import { safeDeleteDir } from "./fsUtils";
import {
    getDatasetRootDirectoryAsync,
    initStorageAsync,
    resetStorageRootsCache,
} from "./roots";

/** Whether this platform lets the user re-pick the storage folder (Android SAF). */
export const supportsFolderSelection = (): boolean => getStorageDriver().supportsFolderSelection;

/**
 * The currently-selected storage root URI (raw content:// / file:// string),
 * or null if none has been chosen yet.
 */
export const getCurrentStorageRootUriAsync = async (): Promise<string | null> => {
    return getStorageDriver().getPersistedRootUriAsync();
};

/**
 * Turn a raw storage URI into something readable in the UI.
 * SAF tree URIs look like:
 *   content://com.android.externalstorage.documents/tree/primary%3APictures%2FDermaImageRecords
 * We decode and surface the human path ("primary:Pictures/DermaImageRecords" -> "Pictures/DermaImageRecords").
 */
export const prettyStoragePath = (uri: string | null): string => {
    if (!uri) return "No folder selected";

    try {
        if (uri.startsWith("content://")) {
            const decoded = decodeURIComponent(uri);
            // Prefer the "/tree/<docId>" segment which carries the real path.
            const treeMatch = decoded.match(/\/tree\/([^/]+(?:\/document\/.*)?)/);
            const raw = treeMatch ? treeMatch[1] : decoded;
            // "primary:Pictures/DermaImageRecords" -> volume + path.
            const [volume, ...rest] = raw.split(":");
            const path = rest.join(":");
            if (!path) return volume;
            const volumeLabel = volume === "primary" ? "Internal storage" : volume;
            return `${volumeLabel}/${path}`;
        }

        if (uri.startsWith("file://")) {
            return decodeURIComponent(uri.replace("file://", ""));
        }
    } catch {
        // Fall through to raw.
    }

    return uri;
};

/**
 * Prompt the user to pick a new storage folder, switch to it, and rebuild the index.
 *
 * "Switch only": existing data in the old folder is left untouched. The app points
 * at the new folder and re-indexes whatever it finds there (empty for a fresh folder).
 *
 * Returns the new root URI, or null if the user cancelled.
 */
export const changeStorageFolderAsync = async (): Promise<string | null> => {
    const driver = getStorageDriver();
    if (!driver.supportsFolderSelection) {
        throw new Error("Changing the storage folder isn't supported on this platform.");
    }

    let newRootUri: string;
    try {
        const newRoot = await driver.changeRootDirectoryAsync();
        newRootUri = newRoot.uri;
    } catch (error) {
        // User cancelled the picker.
        if ((error as Error).message === "Storage location not selected.") return null;
        throw error;
    }

    // Point the roots cache at the newly-persisted folder and rebuild the index
    // from disk. rebuildAllPatientsAsync also updates the dataset-root meta key.
    resetStorageRootsCache();
    await initStorageAsync();
    await clearImageCacheAsync();
    await patientIndexService.rebuildAllPatientsAsync();

    return newRootUri;
};

/**
 * Permanently delete all patient & consultation data AND forget the selected folder,
 * returning the app to a fresh-install state (it will re-prompt for a location on
 * next use).
 */
export const wipeAllDataAsync = async (): Promise<void> => {
    const driver = getStorageDriver();

    // 1) Delete the dataset folder on disk (removes patients + nested consultations + photos).
    try {
        await initStorageAsync();
        const datasetRoot = await getDatasetRootDirectoryAsync();
        await safeDeleteDir(datasetRoot);
    } catch {
        // If the folder is already gone / permission revoked, treat as deleted.
    }

    // 2) Clear the rebuildable SQLite index (rows + meta).
    await dermaDb.clearAllAsync();

    // 3) Drop render-safe cached image copies.
    await clearImageCacheAsync();

    // 4) Forget the selected folder and cached roots so the app re-prompts next time.
    await driver.clearPersistedRootAsync();
    resetStorageRootsCache();
};
