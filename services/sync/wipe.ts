import { Directory } from "expo-file-system";

import { listEntriesSafe } from "../storage/fsUtils";
import { isTempFolderName } from "../storage/records";
import { getPatientsRootDirectoryAsync, initStorageAsync } from "../storage/roots";
import { deletePatient } from "../storage/storage";
import { wipeAllDataAsync } from "../storage/storageLocation";
import { ensureDriveAccessTokenAsync } from "./driveClient";
import { runSyncAsync } from "./syncEngine";
import { syncDb } from "./syncDb";

/**
 * The two meanings of "Wipe all data" once sync exists:
 *
 * - **This device only**: local dataset, index, caches, and every trace of sync state
 *   (including the device identity) are erased. The Drive mirror and other devices are
 *   untouched; re-enabling sync later re-downloads everything.
 *
 * - **Everywhere**: every patient is deleted through the normal path (which records
 *   tombstones), those tombstones are published and the remote folders trashed by a
 *   sync run that MUST succeed before anything else is touched — otherwise the wipe
 *   aborts and nothing is lost. Other devices apply the tombstones on their next sync.
 */

export const wipeDeviceOnlyAsync = async (): Promise<void> => {
    await wipeAllDataAsync();
    await syncDb.clearAllAsync();
};

export const wipeEverywhereAsync = async (): Promise<void> => {
    // Fail fast if Drive isn't reachable — BEFORE anything local is deleted. (If sync
    // still fails mid-run later, the tombstones are durable: re-running this wipe
    // no-ops the local deletions and finishes the remote side.)
    await ensureDriveAccessTokenAsync();

    await initStorageAsync();

    // Delete every patient through the app path so each records its tombstone.
    const patientsRoot = await getPatientsRootDirectoryAsync();
    const patientIds = listEntriesSafe(patientsRoot)
        .filter((e): e is Directory => e instanceof Directory && !isTempFolderName(e.name))
        .map((dir) => dir.name);

    for (const patientId of patientIds) {
        await deletePatient(patientId);
    }

    // Publish the tombstones + trash the remote folders. A failure here throws and the
    // caller surfaces it — the local records are already gone, but the tombstones are
    // durable and the next successful sync finishes the remote side.
    await runSyncAsync();

    // Only now clear the residue (dataset root leftovers, index, caches, folder choice)
    // and this device's sync state.
    await wipeAllDataAsync();
    await syncDb.clearAllAsync();
};
