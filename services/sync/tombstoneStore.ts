import { Directory, File } from "expo-file-system";

import { STORAGE } from "../../constants/storage";
import type { PersistedConsultation, PersistedPatient } from "../../types/models";
import { dermaDb } from "../db/dermaDb";
import { findChildDirectory, findChildFile, readJsonFromDir, safeDeleteDir, safeDeleteFile } from "../storage/fsUtils";
import { getDatasetRootDirectoryAsync } from "../storage/roots";
import {
    createTextFileAsync,
    readTextFileAsync,
    trashFileAsync,
    updateTextFileAsync,
} from "./driveClient";
import type { RemoteTree } from "./remoteTree";
import { syncDb, type TombstoneRow } from "./syncDb";

/**
 * Deletion propagation. App deletions record tombstone rows (see services/storage);
 * each sync cycle:
 *
 * 1. applies OTHER devices' tombstones locally (guarded by uid, and by "an edit after
 *    the deletion survives it"),
 * 2. trashes the remote paths of OWN tombstones (guarded by uid for folders, so a
 *    recreated record under the same name is never destroyed),
 * 3. publishes the own tombstone list to `.sync/device-<deviceId>.json`.
 *
 * A remote file missing WITHOUT a tombstone is Drive-UI tampering and heals by
 * re-upload; deletions are real only when a tombstone says so.
 */

export type PublishedTombstone = {
    relPath: string;
    kind: TombstoneRow["kind"];
    uid: string;
    deletedAt: string;
};

type TombstoneFileContent = {
    schema: 1;
    deviceId: string;
    tombstones: PublishedTombstone[];
};

export const deviceTombstoneFileName = (deviceId: string) => `device-${deviceId}.json`;

/** Resolve a dataset relPath ("patients/X/consultations/Y[/file]") to local Directory/File. */
const resolveLocalAsync = async (
    relPath: string,
): Promise<{ dir: Directory | null; file: File | null; parent: Directory | null }> => {
    const root = await getDatasetRootDirectoryAsync();
    const parts = relPath.split("/").filter(Boolean);
    let current: Directory | null = root;
    for (let i = 0; i < parts.length - 1; i += 1) {
        current = current ? findChildDirectory(current, parts[i]) : null;
    }
    const leaf = parts[parts.length - 1];
    if (!current || !leaf) return { dir: null, file: null, parent: null };
    return {
        dir: findChildDirectory(current, leaf),
        file: findChildFile(current, leaf),
        parent: current,
    };
};

/** The record uid found at a local dir's json (patient or consultation), or null. */
const readLocalRecordAsync = async (
    dir: Directory,
    kind: TombstoneRow["kind"],
): Promise<{ uid: string; updatedAt: string } | null> => {
    const fileName = kind === "patient" ? STORAGE.patientFileName : STORAGE.consultationFileName;
    const json = await readJsonFromDir<PersistedPatient | PersistedConsultation>(dir, fileName);
    if (!json?.uid) return null;
    return { uid: json.uid, updatedAt: json.updatedAt ?? "" };
};

/**
 * Apply one remote device's tombstones locally. Returns the patient ids whose local
 * data changed (so the caller can refresh index rows).
 */
export const applyRemoteTombstonesAsync = async (
    tombstones: readonly PublishedTombstone[],
): Promise<Set<string>> => {
    const touchedPatients = new Set<string>();

    for (const t of tombstones) {
        try {
            const parts = t.relPath.split("/").filter(Boolean);
            if (parts[0] !== STORAGE.patientsFolderName || parts.length < 2) continue;
            const patientId = parts[1];

            if (t.kind === "photo") {
                const { file } = await resolveLocalAsync(t.relPath);
                if (!file) continue;

                // Guard: if the owning consultation's json lists this file name under a
                // DIFFERENT uid, the name belongs to another photo now — leave it. The
                // consultation dir is always `patients/<id>/consultations/<cid>` (the
                // photo itself may sit one level deeper, in `thumbs/`).
                const consultationDirPath = parts.slice(0, 4).join("/");
                const { dir: consultationDir } = await resolveLocalAsync(consultationDirPath);
                if (consultationDir) {
                    const json = await readJsonFromDir<PersistedConsultation>(
                        consultationDir,
                        STORAGE.consultationFileName,
                    );
                    const listed = json?.photos?.find(
                        (p) => p.file === file.name || p.thumb?.endsWith(`/${file.name}`),
                    );
                    if (listed && listed.uid !== t.uid) continue;
                }

                await safeDeleteFile(file);
                touchedPatients.add(patientId);
                continue;
            }

            const { dir } = await resolveLocalAsync(t.relPath);
            if (!dir) continue;

            const record = await readLocalRecordAsync(dir, t.kind);
            // uid must match: a renumbered/recreated record under the same path survives.
            if (!record || record.uid !== t.uid) continue;
            // An edit made after the deletion survives it.
            if ((Date.parse(record.updatedAt) || 0) > (Date.parse(t.deletedAt) || 0)) continue;

            await safeDeleteDir(dir);
            touchedPatients.add(patientId);

            if (t.kind === "patient") {
                await dermaDb.deletePatientAsync(patientId);
                await dermaDb.deleteMetaByPrefixAsync(`consultations.patient.${patientId}.`);
            } else {
                await dermaDb.deleteConsultationAsync(patientId, parts[3] ?? dir.name);
            }
        } catch {
            // One bad tombstone must not stop the pass; the next cycle retries.
        }
    }

    return touchedPatients;
};

/**
 * Trash the remote counterparts of this device's tombstones and prune their sync state.
 * Folder tombstones verify the remote record's uid first (a small json read), so a
 * record another device recreated under the same name is never destroyed — a stale
 * tombstone is dropped instead by returning it in `stale`.
 */
export const trashRemoteForLocalTombstonesAsync = async (
    accessToken: string,
    tombstones: readonly TombstoneRow[],
    remote: RemoteTree,
): Promise<{ trashedPaths: string[] }> => {
    const trashedPaths: string[] = [];

    for (const t of tombstones) {
        const node = remote.byRelPath.get(t.relPath);
        if (!node) {
            await syncDb.deleteStateByPrefixAsync(t.relPath);
            continue;
        }

        try {
            if (node.isDir && (t.kind === "patient" || t.kind === "consultation")) {
                const jsonName =
                    t.kind === "patient" ? STORAGE.patientFileName : STORAGE.consultationFileName;
                const jsonNode = remote.byRelPath.get(`${t.relPath}/${jsonName}`);
                if (jsonNode) {
                    try {
                        const raw = await readTextFileAsync(accessToken, jsonNode.id);
                        const parsed = JSON.parse(raw) as { uid?: string };
                        if (parsed.uid && parsed.uid !== t.uid) {
                            // Recreated under the same name by another device — tombstone is stale.
                            continue;
                        }
                    } catch {
                        // Unreadable remote json: fall through and trash (it matches our state).
                    }
                }
            }

            await trashFileAsync(accessToken, node.id);
            trashedPaths.push(t.relPath);
            await syncDb.deleteStateByPrefixAsync(t.relPath);
        } catch {
            // Leave the tombstone pending; retried next cycle.
        }
    }

    return { trashedPaths };
};

/** Write this device's full tombstone list to its remote `.sync/device-<id>.json`. */
export const publishTombstonesAsync = async (
    accessToken: string,
    deviceId: string,
    syncFolderId: string,
    existingFileId: string | null,
    tombstones: readonly TombstoneRow[],
): Promise<void> => {
    const content: TombstoneFileContent = {
        schema: 1,
        deviceId,
        tombstones: tombstones.map(({ relPath, kind, uid, deletedAt }) => ({
            relPath,
            kind,
            uid,
            deletedAt,
        })),
    };
    const serialized = JSON.stringify(content);

    let ok = false;
    if (existingFileId) {
        ok = (await updateTextFileAsync(accessToken, existingFileId, serialized)) !== null;
    }
    if (!ok) {
        await createTextFileAsync(
            accessToken,
            deviceTombstoneFileName(deviceId),
            syncFolderId,
            serialized,
        );
    }

    await syncDb.markTombstonesUploadedAsync(tombstones.map((t) => t.relPath));
};

/** Parse a remote tombstone file's content defensively. */
export const parseTombstoneFile = (raw: string): PublishedTombstone[] => {
    try {
        const parsed = JSON.parse(raw) as Partial<TombstoneFileContent>;
        if (!Array.isArray(parsed.tombstones)) return [];
        return parsed.tombstones.filter(
            (t): t is PublishedTombstone =>
                typeof t?.relPath === "string" &&
                typeof t?.uid === "string" &&
                typeof t?.deletedAt === "string" &&
                (t.kind === "patient" || t.kind === "consultation" || t.kind === "photo"),
        );
    } catch {
        return [];
    }
};
