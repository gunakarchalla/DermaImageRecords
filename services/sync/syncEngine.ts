import * as Crypto from "expo-crypto";
import { Directory, File, Paths } from "expo-file-system";

import { STORAGE } from "../../constants/storage";
import { SYNC } from "../../constants/sync";
import type { PersistedConsultation, PersistedPatient } from "../../types/models";
import { mapWithConcurrency } from "../async";
import { nextSequentialCid } from "../consultation/cid";
import { bumpDatasetRevision, getDatasetRevision } from "../datasetRevision";
import { dermaDb } from "../db/dermaDb";
import { consultationIndexService } from "../indexing/consultationIndexService";
import { patientIndexService } from "../indexing/patientIndexService";
import { generateEmrNumberAsync } from "../patient/emr";
import { getStorageDriver } from "../storage/drivers";
import {
    findChildDirectory,
    getOrCreateChildDirectoryAsync,
    listEntriesSafe,
    readJsonFromDir,
    replaceFileInDirectoryAsync,
    safeDeleteFile,
} from "../storage/fsUtils";
import { isTempFolderName, readPatientAsync, renamePhotoFileName } from "../storage/records";
import { renameConsultationDirAsync, renamePatientDirAsync } from "../storage/rename";
import {
    getDatasetRootDirectoryAsync,
    getExistingPatientDir,
    getPatientsRootDirectoryAsync,
    initStorageAsync,
} from "../storage/roots";
import {
    planChronologicalRenumber,
    planEmrCollision,
    resolveLww,
    sequenceRenames,
} from "./collisions";
import { diffTrees, type DiffLocalNode, type DiffRemoteNode, type DiffStateRow, type SyncAction } from "./diff";
import {
    createFolderAsync,
    createTextFileAsync,
    downloadToFileAsync,
    ensureDriveAccessTokenAsync,
    getChangesStartTokenAsync,
    isRemoteFolder,
    listAllFilesAsync,
    probeChangesSinceAsync,
    readTextFileAsync,
    trashFileAsync,
    updateTextFileAsync,
    uploadFileAsync,
} from "./driveClient";
import { buildLocalTreeAsync, type LocalNode } from "./localTree";
import { buildRemoteTree, type RemoteTree } from "./remoteTree";
import { syncDb } from "./syncDb";
import {
    applyRemoteTombstonesAsync,
    deviceTombstoneFileName,
    parseTombstoneFile,
    publishTombstonesAsync,
    trashRemoteForLocalTombstonesAsync,
} from "./tombstoneStore";

/**
 * The sync orchestrator. One cycle:
 *
 *   token → remote listing → root resolution → apply remote tombstones → trash/publish
 *   own tombstones → three-way diff → reconcile JSON conflicts (LWW / uid collisions /
 *   chronological renumber) → transfers (concurrency-bounded) → index refresh.
 *
 * Every step is idempotent and per-file failures don't abort the cycle, so repeated runs
 * converge. Structural changes (renames, collisions) set `structuralChange`; the caller
 * chains a follow-up cycle so listing-based state trues up quickly.
 */

export class SyncPreconditionError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "SyncPreconditionError";
    }
}

export type SyncSummary = {
    uploaded: number;
    downloaded: number;
    trashed: number;
    conflicts: number;
    renames: number;
    heals: number;
    errors: number;
    structuralChange: boolean;
};

const emptySummary = (): SyncSummary => ({
    uploaded: 0,
    downloaded: 0,
    trashed: 0,
    conflicts: 0,
    renames: 0,
    heals: 0,
    errors: 0,
    structuralChange: false,
});

let running = false;
let lastFinishedAt = 0;

/**
 * The dataset revision as of the start of the last fully-clean cycle, or null when the
 * next cycle must be a full one (errors, local changes applied, or first run since
 * launch). Together with the Drive changes token this lets an idle trigger — app
 * foregrounded, periodic timer — cost one probe request instead of a full listing.
 */
let cleanCycleRevision: number | null = null;

export const isSyncRunning = () => running;
export const getLastSyncFinishedAt = () => lastFinishedAt;

const md5Async = (content: string) =>
    Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.MD5, content);

const parentRelPath = (relPath: string) => {
    const idx = relPath.lastIndexOf("/");
    return idx === -1 ? "" : relPath.slice(0, idx);
};

const leafName = (relPath: string) => relPath.split("/").pop() ?? relPath;

const mimeForName = (name: string): string => {
    const lower = name.toLowerCase();
    if (lower.endsWith(".png")) return "image/png";
    if (lower.endsWith(".webp")) return "image/webp";
    if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
    if (lower.endsWith(".json")) return "application/json";
    return "application/octet-stream";
};

/** patientId for a dataset relPath, or null for root-level files (clinic.json later). */
const patientIdOf = (relPath: string): string | null => {
    const parts = relPath.split("/");
    return parts[0] === STORAGE.patientsFolderName && parts.length > 1 ? parts[1] : null;
};

/** Walk/create the local directory chain for `relDirPath` under the dataset root. */
const ensureLocalDirAsync = async (relDirPath: string): Promise<Directory> => {
    let dir = await getDatasetRootDirectoryAsync();
    for (const part of relDirPath.split("/").filter(Boolean)) {
        dir = await getOrCreateChildDirectoryAsync(dir, part);
    }
    return dir;
};

const writeLocalFileAsync = async (relPath: string, bytes: Uint8Array): Promise<void> => {
    const dir = await ensureLocalDirAsync(parentRelPath(relPath));
    const file = await replaceFileInDirectoryAsync(dir, leafName(relPath), mimeForName(relPath));
    file.write(bytes);
};

const writeLocalTextAsync = async (relPath: string, content: string): Promise<void> => {
    const dir = await ensureLocalDirAsync(parentRelPath(relPath));
    const file = await replaceFileInDirectoryAsync(dir, leafName(relPath), "application/json");
    file.write(content);
};

/**
 * The legacy native uploader streams from a filesystem path and CANNOT read SAF
 * `content://` URIs — which is where Android keeps the dataset. Stage those to a cache
 * temp first (the new FS API reads content:// fine); `file://` sources pass through.
 */
const stageUploadSourceAsync = async (
    uri: string,
): Promise<{ uri: string; disposeAsync: () => Promise<void> }> => {
    if (uri.startsWith("file://")) {
        return { uri, disposeAsync: async () => {} };
    }

    const temp = new File(
        Paths.cache,
        `sync-up-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    );
    temp.create({ intermediates: true, overwrite: true });
    temp.write(await new File(uri).bytes());
    return { uri: temp.uri, disposeAsync: async () => safeDeleteFile(temp) };
};

export const runSyncAsync = async (): Promise<SyncSummary> => {
    if (running) return emptySummary();
    running = true;
    try {
        let summary = await runOneCycleAsync();
        // Structural changes (renames/collisions) leave work for a listing-fresh pass.
        for (let i = 0; summary.structuralChange && i < SYNC.maxChainedRuns; i += 1) {
            const next = await runOneCycleAsync();
            summary = {
                uploaded: summary.uploaded + next.uploaded,
                downloaded: summary.downloaded + next.downloaded,
                trashed: summary.trashed + next.trashed,
                conflicts: summary.conflicts + next.conflicts,
                renames: summary.renames + next.renames,
                heals: summary.heals + next.heals,
                errors: summary.errors + next.errors,
                structuralChange: next.structuralChange,
            };
        }
        await syncDb.setMetaAsync("lastSyncAt", new Date().toISOString());
        return summary;
    } finally {
        running = false;
        lastFinishedAt = Date.now();
    }
};

const runOneCycleAsync = async (): Promise<SyncSummary> => {
    const summary = emptySummary();

    // Never let a background trigger open the SAF folder picker.
    const persistedRoot = await getStorageDriver().getPersistedRootUriAsync();
    if (!persistedRoot) {
        throw new SyncPreconditionError("Choose a storage folder before turning on sync.");
    }

    const token = await ensureDriveAccessTokenAsync();
    await initStorageAsync();

    // ---- fast skip: nothing changed on either side since the last clean cycle ----
    const revisionAtStart = getDatasetRevision();
    const changesToken = await syncDb.getMetaAsync("driveChangesToken");
    if (changesToken && cleanCycleRevision === revisionAtStart) {
        const tombstoneRows = await syncDb.readAllTombstonesAsync();
        const hasUnpublished = tombstoneRows.some((t) => t.uploadedAt === null);
        if (!hasUnpublished) {
            const probe = await probeChangesSinceAsync(token, changesToken);
            if (probe && !probe.changed) {
                if (probe.newStartPageToken) {
                    await syncDb.setMetaAsync("driveChangesToken", probe.newStartPageToken);
                }
                return emptySummary();
            }
        }
    }

    // ---- remote root + tree ----
    const files = await listAllFilesAsync(token);
    const storedRootId = await syncDb.getMetaAsync("driveRootFolderId");
    const rootFile =
        files.find((f) => f.id === storedRootId && isRemoteFolder(f)) ??
        files.find(
            (f) =>
                isRemoteFolder(f) &&
                f.appProperties?.[SYNC.appPropertyKey] === SYNC.appPropertyValue &&
                f.appProperties?.[SYNC.rootRoleKey] === SYNC.rootRoleValue,
        );
    const rootId =
        rootFile?.id ??
        (await createFolderAsync(token, STORAGE.externalRootFolderName, null, {
            [SYNC.appPropertyKey]: SYNC.appPropertyValue,
            [SYNC.rootRoleKey]: SYNC.rootRoleValue,
        }));
    if (rootId !== storedRootId) await syncDb.setMetaAsync("driveRootFolderId", rootId);

    const remote = buildRemoteTree(files, rootId);
    const deviceId = await syncDb.getOrCreateDeviceIdAsync();

    // ---- 1. apply other devices' tombstones locally ----
    const touchedPatients = new Set<string>();
    let appliedRemoteDeletes = false;
    for (const [relPath, node] of remote.byRelPath) {
        if (!relPath.startsWith(`${SYNC.syncMetaFolderName}/device-`)) continue;
        if (relPath === `${SYNC.syncMetaFolderName}/${deviceTombstoneFileName(deviceId)}`) continue;

        const markerKey = `tombMd5.${leafName(relPath)}`;
        const seenMd5 = await syncDb.getMetaAsync(markerKey);
        if (node.md5 && node.md5 === seenMd5) continue;

        try {
            const tombstones = parseTombstoneFile(await readTextFileAsync(token, node.id));
            const touched = await applyRemoteTombstonesAsync(tombstones);
            touched.forEach((pid) => touchedPatients.add(pid));
            if (touched.size > 0) appliedRemoteDeletes = true;
            if (node.md5) await syncDb.setMetaAsync(markerKey, node.md5);
        } catch {
            summary.errors += 1;
        }
    }

    // ---- 2. trash remote paths for own tombstones, then publish them ----
    const tombstones = await syncDb.readAllTombstonesAsync();
    if (tombstones.length > 0) {
        const { trashedPaths } = await trashRemoteForLocalTombstonesAsync(token, tombstones, remote);
        summary.trashed += trashedPaths.length;
        for (const relPath of trashedPaths) {
            // Trashing a folder removes its whole subtree from the mirror.
            for (const key of [...remote.byRelPath.keys()]) {
                if (key === relPath || key.startsWith(`${relPath}/`)) remote.byRelPath.delete(key);
            }
            for (const key of [...remote.dirIdByRelPath.keys()]) {
                if (key === relPath || key.startsWith(`${relPath}/`)) remote.dirIdByRelPath.delete(key);
            }
        }

        const hasUnpublished = tombstones.some((t) => t.uploadedAt === null);
        if (hasUnpublished || trashedPaths.length > 0) {
            try {
                const syncFolderId =
                    remote.dirIdByRelPath.get(SYNC.syncMetaFolderName) ??
                    (await createFolderAsync(token, SYNC.syncMetaFolderName, rootId));
                remote.dirIdByRelPath.set(SYNC.syncMetaFolderName, syncFolderId);
                const ownFile = remote.byRelPath.get(
                    `${SYNC.syncMetaFolderName}/${deviceTombstoneFileName(deviceId)}`,
                );
                await publishTombstonesAsync(token, deviceId, syncFolderId, ownFile?.id ?? null, tombstones);
            } catch {
                summary.errors += 1; // retried next cycle
            }
        }
    }

    // ---- 3. three-way diff over the dataset (never over .sync metadata) ----
    const local = await buildLocalTreeAsync();
    const state = await syncDb.readAllStateAsync();

    const localForDiff = new Map<string, DiffLocalNode>();
    for (const [relPath, node] of local) {
        localForDiff.set(relPath, { isDir: node.isDir, jsonFingerprint: node.jsonFingerprint });
    }
    const remoteForDiff = new Map<string, DiffRemoteNode>();
    for (const [relPath, node] of remote.byRelPath) {
        if (relPath === SYNC.syncMetaFolderName || relPath.startsWith(`${SYNC.syncMetaFolderName}/`)) continue;
        remoteForDiff.set(relPath, { id: node.id, isDir: node.isDir, md5: node.md5 });
    }
    const stateForDiff = new Map<string, DiffStateRow>();
    for (const [relPath, row] of state) {
        stateForDiff.set(relPath, row);
    }

    const actions = diffTrees(localForDiff, remoteForDiff, stateForDiff);

    // ---- 4. reconcile JSON conflicts first (they can invalidate sibling actions) ----
    const skipPrefixes: string[] = [];
    const isSkipped = (relPath: string) =>
        skipPrefixes.some((p) => relPath === p || relPath.startsWith(`${p}/`));

    for (const action of actions) {
        if (action.kind !== "reconcileJson" || isSkipped(action.relPath)) continue;
        try {
            await reconcileJsonAsync(token, action.relPath, action.fileId, local, remote, {
                summary,
                touchedPatients,
                skipPrefixes,
            });
        } catch {
            summary.errors += 1;
        }
    }

    // ---- 5. transfers ----
    // Remote folder creation must be serialized per path or concurrency mints duplicates.
    const dirCreations = new Map<string, Promise<string>>();
    const ensureRemoteDirAsync = (relDirPath: string): Promise<string> => {
        const existing = remote.dirIdByRelPath.get(relDirPath);
        if (existing) return Promise.resolve(existing);
        const pending = dirCreations.get(relDirPath);
        if (pending) return pending;

        const creation = (async () => {
            const parentId =
                relDirPath === "" ? rootId : await ensureRemoteDirAsync(parentRelPath(relDirPath));
            const inTree = remote.dirIdByRelPath.get(relDirPath);
            if (inTree) return inTree;
            const id = await createFolderAsync(token, leafName(relDirPath), parentId);
            remote.dirIdByRelPath.set(relDirPath, id);
            return id;
        })();
        dirCreations.set(relDirPath, creation);
        return creation;
    };

    const transferable = actions.filter(
        (a) =>
            !isSkipped(a.relPath) &&
            (a.kind === "upload" ||
                a.kind === "reuploadMissing" ||
                a.kind === "download" ||
                a.kind === "redownloadMissing" ||
                a.kind === "uploadJsonChanged" ||
                a.kind === "downloadJsonChanged"),
    );
    // Photos before JSONs on the download side, so a consultation.json is applied only
    // after the files it references exist locally.
    transferable.sort((a, b) => {
        const aJson = a.relPath.endsWith(".json") ? 1 : 0;
        const bJson = b.relPath.endsWith(".json") ? 1 : 0;
        return aJson - bJson;
    });

    let anyLocalChange = appliedRemoteDeletes;
    const transferFailures: { relPath: string; message: string }[] = [];

    await mapWithConcurrency(transferable, SYNC.transferConcurrency, async (action) => {
        try {
            switch (action.kind) {
                case "upload":
                case "reuploadMissing": {
                    const node = local.get(action.relPath);
                    if (!node?.uri) return;
                    const parentId = await ensureRemoteDirAsync(parentRelPath(action.relPath));
                    if (action.relPath.endsWith(".json")) {
                        const content = await new File(node.uri).text();
                        const fileId = await createTextFileAsync(
                            token,
                            leafName(action.relPath),
                            parentId,
                            content,
                        );
                        await syncDb.upsertStateAsync({
                            relPath: action.relPath,
                            driveFileId: fileId,
                            remoteMd5: await md5Async(content),
                            localFingerprint: await md5Async(content),
                            isDir: false,
                            syncedAt: new Date().toISOString(),
                        });
                    } else {
                        const staged = await stageUploadSourceAsync(node.uri);
                        let fileId: string;
                        try {
                            fileId = await uploadFileAsync(
                                token,
                                leafName(action.relPath),
                                parentId,
                                staged.uri,
                                node.mimeType,
                            );
                        } finally {
                            await staged.disposeAsync();
                        }
                        await syncDb.upsertStateAsync({
                            relPath: action.relPath,
                            driveFileId: fileId,
                            remoteMd5: null,
                            localFingerprint: null,
                            isDir: false,
                            syncedAt: new Date().toISOString(),
                        });
                    }
                    summary.uploaded += 1;
                    if (action.kind === "reuploadMissing") {
                        summary.heals += 1;
                        await syncDb.appendLogAsync(
                            "info",
                            `Restored "${action.relPath}" to Drive (it was removed there outside the app).`,
                        );
                    }
                    return;
                }

                case "uploadJsonChanged": {
                    const node = local.get(action.relPath);
                    if (!node?.uri) return;
                    const content = await new File(node.uri).text();
                    let fileId: string | null = await updateTextFileAsync(token, action.fileId, content);
                    if (fileId === null) {
                        const parentId = await ensureRemoteDirAsync(parentRelPath(action.relPath));
                        fileId = await createTextFileAsync(token, leafName(action.relPath), parentId, content);
                    }
                    await syncDb.upsertStateAsync({
                        relPath: action.relPath,
                        driveFileId: fileId,
                        remoteMd5: await md5Async(content),
                        localFingerprint: await md5Async(content),
                        isDir: false,
                        syncedAt: new Date().toISOString(),
                    });
                    summary.uploaded += 1;
                    return;
                }

                case "download":
                case "redownloadMissing":
                case "downloadJsonChanged": {
                    if (action.relPath.endsWith(".json")) {
                        const content = await readTextFileAsync(token, action.fileId);
                        await writeLocalTextAsync(action.relPath, content);
                        const digest = await md5Async(content);
                        await syncDb.upsertStateAsync({
                            relPath: action.relPath,
                            driveFileId: action.fileId,
                            remoteMd5: digest,
                            localFingerprint: digest,
                            isDir: false,
                            syncedAt: new Date().toISOString(),
                        });
                    } else {
                        const temp = new File(
                            Paths.cache,
                            `sync-dl-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
                        );
                        try {
                            await downloadToFileAsync(token, action.fileId, temp.uri);
                            await writeLocalFileAsync(action.relPath, await temp.bytes());
                        } finally {
                            await safeDeleteFile(temp);
                        }
                        await syncDb.upsertStateAsync({
                            relPath: action.relPath,
                            driveFileId: action.fileId,
                            remoteMd5: remote.byRelPath.get(action.relPath)?.md5 ?? null,
                            localFingerprint: null,
                            isDir: false,
                            syncedAt: new Date().toISOString(),
                        });
                    }
                    const pid = patientIdOf(action.relPath);
                    if (pid) touchedPatients.add(pid);
                    anyLocalChange = true;
                    summary.downloaded += 1;
                    if (action.kind === "redownloadMissing") {
                        summary.heals += 1;
                        await syncDb.appendLogAsync(
                            "info",
                            `Restored "${action.relPath}" from Drive (it was removed here outside the app).`,
                        );
                    }
                    return;
                }
            }
        } catch (error) {
            summary.errors += 1;
            transferFailures.push({
                relPath: action.relPath,
                message: (error as Error).message || "unknown error",
            });
        }
    });

    // Failed transfers are retried automatically next cycle, but they must be VISIBLE:
    // a photo that never uploads while everything else syncs looks like silent success.
    if (transferFailures.length > 0) {
        for (const failure of transferFailures.slice(0, 3)) {
            await syncDb.appendLogAsync(
                "error",
                `Couldn't sync "${failure.relPath}": ${failure.message}`,
            );
        }
        if (transferFailures.length > 3) {
            await syncDb.appendLogAsync(
                "error",
                `…and ${transferFailures.length - 3} more items failed. They'll be retried on the next sync.`,
            );
        }
    }

    // ---- 6. bookkeeping actions ----
    for (const action of actions) {
        if (isSkipped(action.relPath)) continue;
        try {
            if (action.kind === "adoptState" && !action.isDir) {
                await syncDb.upsertStateAsync({
                    relPath: action.relPath,
                    driveFileId: action.fileId,
                    remoteMd5: action.remoteMd5,
                    localFingerprint: action.localFingerprint,
                    isDir: false,
                    syncedAt: new Date().toISOString(),
                });
            } else if (action.kind === "dropState") {
                await syncDb.deleteStateAsync(action.relPath);
            }
        } catch {
            summary.errors += 1;
        }
    }

    // ---- 7. refresh index rows for everything sync touched locally ----
    if (touchedPatients.size > 0) {
        const patientsRoot = await getPatientsRootDirectoryAsync();
        for (const pid of touchedPatients) {
            try {
                const dir = findChildDirectory(patientsRoot, pid);
                if (dir) {
                    const patient = await readPatientAsync(dir);
                    if (patient) {
                        await patientIndexService.upsertPatientAsync({
                            ...patient,
                            id: pid,
                            emrNumber: pid,
                        });
                    }
                } else {
                    await dermaDb.deletePatientAsync(pid);
                }
                // Drop rows + reindex stamp; the next query lazily rebuilds from disk.
                await consultationIndexService.deleteConsultationsByPatientAsync(pid);
            } catch {
                summary.errors += 1;
            }
        }
        anyLocalChange = true;
    }

    if (anyLocalChange) bumpDatasetRevision();

    // Arm the fast skip only after a fully clean, change-free-locally cycle: any error
    // or applied local change forces the next cycle to list fully. The token is minted
    // AFTER our own uploads, so they don't read back as "remote changes".
    if (summary.errors === 0 && !summary.structuralChange) {
        const freshToken = await getChangesStartTokenAsync(token);
        if (freshToken) await syncDb.setMetaAsync("driveChangesToken", freshToken);
        cleanCycleRevision = anyLocalChange ? null : revisionAtStart;
    } else {
        cleanCycleRevision = null;
    }

    return summary;
};

// ---------------------------------------------------------------------------
// JSON reconciliation (LWW + uid collisions)
// ---------------------------------------------------------------------------

type ReconcileContext = {
    summary: SyncSummary;
    touchedPatients: Set<string>;
    skipPrefixes: string[];
};

const reconcileJsonAsync = async (
    token: string,
    relPath: string,
    fileId: string,
    local: Map<string, LocalNode>,
    remote: RemoteTree,
    ctx: ReconcileContext,
): Promise<void> => {
    const node = local.get(relPath);
    if (!node?.uri) return;

    const localContent = await new File(node.uri).text();
    const remoteContent = await readTextFileAsync(token, fileId);

    let localJson: { uid?: string; updatedAt?: string } = {};
    let remoteJson: { uid?: string; updatedAt?: string } = {};
    try {
        localJson = JSON.parse(localContent);
    } catch {
        // Unreadable local json: let the remote copy win below.
    }
    try {
        remoteJson = JSON.parse(remoteContent);
    } catch {
        // Unreadable remote json: local wins below.
        remoteJson = { updatedAt: "" };
    }

    const name = leafName(relPath);
    const pid = patientIdOf(relPath);

    // ---- uid collision: two different records claim the same folder ----
    if (localJson.uid && remoteJson.uid && localJson.uid !== remoteJson.uid && pid) {
        if (name === STORAGE.patientFileName) {
            const plan = planEmrCollision(localJson.uid, remoteJson.uid);
            const patientPrefix = `${STORAGE.patientsFolderName}/${pid}`;
            if (plan === "renameLocal") {
                const newEmr = await generateEmrNumberAsync();
                await renamePatientDirAsync(pid, newEmr);
                await syncDb.deleteStateByPrefixAsync(patientPrefix);
                await dermaDb.deletePatientAsync(pid);
                await dermaDb.deleteMetaByPrefixAsync(`consultations.patient.${pid}.`);
                ctx.touchedPatients.add(newEmr);
                ctx.summary.renames += 1;
                ctx.summary.structuralChange = true;
                await syncDb.appendLogAsync(
                    "renamed",
                    `EMR "${pid}" was already used by a different patient on another device; this device's patient is now EMR "${newEmr}".`,
                );
            } else {
                ctx.summary.conflicts += 1;
                await syncDb.appendLogAsync(
                    "info",
                    `EMR "${pid}" is claimed by two different patients; waiting for the other device to renumber.`,
                );
            }
            ctx.skipPrefixes.push(patientPrefix);
            return;
        }

        if (name === STORAGE.consultationFileName) {
            await resolveCidCollisionAsync(token, relPath, remoteContent, remote, ctx);
            return;
        }
    }

    // ---- same record on both sides: whole-record newest-wins ----
    const resolution = resolveLww(
        localJson.updatedAt,
        remoteJson.updatedAt,
        localContent,
        remoteContent,
    );

    if (localContent !== remoteContent) {
        ctx.summary.conflicts += 1;
        await syncDb.appendLogAsync(
            "conflict",
            `"${relPath}" changed on two devices; kept the ${resolution === "keepLocal" ? "newer local" : "newer remote"} version.`,
        );
    }

    if (resolution === "keepLocal") {
        let newFileId: string | null = await updateTextFileAsync(token, fileId, localContent);
        if (newFileId === null) {
            const parentId = remote.dirIdByRelPath.get(parentRelPath(relPath));
            if (!parentId) return; // parent gone remotely; next cycle re-creates the subtree
            newFileId = await createTextFileAsync(token, leafName(relPath), parentId, localContent);
        }
        const digest = await md5Async(localContent);
        await syncDb.upsertStateAsync({
            relPath,
            driveFileId: newFileId,
            remoteMd5: digest,
            localFingerprint: digest,
            isDir: false,
            syncedAt: new Date().toISOString(),
        });
        ctx.summary.uploaded += 1;
    } else {
        await writeLocalTextAsync(relPath, remoteContent);
        const digest = await md5Async(remoteContent);
        await syncDb.upsertStateAsync({
            relPath,
            driveFileId: fileId,
            remoteMd5: digest,
            localFingerprint: digest,
            isDir: false,
            syncedAt: new Date().toISOString(),
        });
        if (pid) ctx.touchedPatients.add(pid);
        ctx.summary.downloaded += 1;
    }
};

/**
 * Same CID, different uids: two distinct visits. The remote one is adopted locally under
 * the next free CID (photo names rewritten), its remote folder is trashed (it re-uploads
 * under the new name next cycle), and the patient's numeric CIDs are chronologically
 * renumbered — the deterministic rule both devices share, so they converge.
 */
const resolveCidCollisionAsync = async (
    token: string,
    relPath: string,
    remoteJsonContent: string,
    remote: RemoteTree,
    ctx: ReconcileContext,
): Promise<void> => {
    const parts = relPath.split("/");
    const pid = parts[1];
    const collidingCid = parts[3];
    const consultationsPrefix = `${STORAGE.patientsFolderName}/${pid}/${STORAGE.consultationsFolderName}`;

    const patientDir = getExistingPatientDir(pid);
    if (!patientDir) return;
    const consultationsDir = await getOrCreateChildDirectoryAsync(
        patientDir,
        STORAGE.consultationsFolderName,
    );

    let remoteRecord: PersistedConsultation;
    try {
        remoteRecord = JSON.parse(remoteJsonContent) as PersistedConsultation;
    } catch {
        return;
    }

    // 1. Adopt the remote visit locally under the next free CID.
    const existingNames = listEntriesSafe(consultationsDir)
        .filter((e) => !(e instanceof File) && !isTempFolderName(e.name))
        .map((e) => e.name);
    const placeholderCid = nextSequentialCid(existingNames);
    const destDir = await getOrCreateChildDirectoryAsync(consultationsDir, placeholderCid);
    const thumbsDest = await getOrCreateChildDirectoryAsync(destDir, STORAGE.thumbsFolderName);

    const remoteFolderPrefix = `${consultationsPrefix}/${collidingCid}`;
    for (const [remotePath, remoteNode] of remote.byRelPath) {
        if (!remotePath.startsWith(`${remoteFolderPrefix}/`) || remoteNode.isDir) continue;
        const fileName = leafName(remotePath);
        if (fileName === STORAGE.consultationFileName) continue;

        const newName = renamePhotoFileName(fileName, remoteRecord.patientId, remoteRecord.cid, pid, placeholderCid);
        const isThumb = remotePath.includes(`/${STORAGE.thumbsFolderName}/`);
        const temp = new File(Paths.cache, `sync-cid-${Date.now().toString(36)}-${newName}`);
        try {
            await downloadToFileAsync(token, remoteNode.id, temp.uri);
            const target = await replaceFileInDirectoryAsync(
                isThumb ? thumbsDest : destDir,
                newName,
                mimeForName(newName),
            );
            target.write(await temp.bytes());
        } finally {
            await safeDeleteFile(temp);
        }
    }

    const adopted: PersistedConsultation = {
        ...remoteRecord,
        id: placeholderCid,
        cid: placeholderCid,
        patientId: pid,
        photos: (remoteRecord.photos ?? []).map((entry) => {
            const newFile = renamePhotoFileName(entry.file, remoteRecord.patientId, remoteRecord.cid, pid, placeholderCid);
            const thumbName = entry.thumb?.split("/").pop();
            const newThumb = thumbName
                ? `${STORAGE.thumbsFolderName}/${renamePhotoFileName(thumbName, remoteRecord.patientId, remoteRecord.cid, pid, placeholderCid)}`
                : undefined;
            return { ...entry, file: newFile, thumb: newThumb };
        }),
    };
    await writeLocalTextAsync(`${consultationsPrefix}/${placeholderCid}/${STORAGE.consultationFileName}`, JSON.stringify(adopted, null, 2));

    // 2. The remote folder now lives locally under the new CID: trash the remote copy
    //    (it re-uploads under its final name next cycle) and forget its state.
    const remoteFolderNode = remote.byRelPath.get(remoteFolderPrefix);
    if (remoteFolderNode) {
        await trashFileAsync(token, remoteFolderNode.id);
        ctx.summary.trashed += 1;
    }
    await syncDb.deleteStateByPrefixAsync(remoteFolderPrefix);

    // 3. Chronological renumber of the patient's numeric CIDs — deterministic on
    //    (createdAt, uid), so every device assigns the same final numbers.
    const items: { cid: string; createdAt: string; uid: string }[] = [];
    for (const entry of listEntriesSafe(consultationsDir)) {
        if (entry instanceof File || isTempFolderName(entry.name)) continue;
        const json = await readJsonFromDir<PersistedConsultation>(entry, STORAGE.consultationFileName);
        if (json?.uid) items.push({ cid: entry.name, createdAt: json.createdAt ?? "", uid: json.uid });
    }

    const plans = sequenceRenames(planChronologicalRenumber(items));
    const tempNames = new Map<string, string>();
    for (const plan of plans) {
        if (!plan.viaTemp) continue;
        const tempName = `tmp~${plan.from}`;
        await renameConsultationDirAsync(consultationsDir, plan.from, tempName, pid);
        tempNames.set(plan.from, tempName);
    }
    for (const plan of plans) {
        const from = tempNames.get(plan.from) ?? plan.from;
        await renameConsultationDirAsync(consultationsDir, from, plan.to, pid);

        // The remote copy under the old name (if any) is superseded: trash it so the
        // renamed folder re-uploads fresh; metadata-only remote renames are a later
        // optimization.
        const oldRemote = remote.byRelPath.get(`${consultationsPrefix}/${plan.from}`);
        if (oldRemote) {
            try {
                await trashFileAsync(token, oldRemote.id);
                ctx.summary.trashed += 1;
            } catch {
                ctx.summary.errors += 1;
            }
        }
        await syncDb.deleteStateByPrefixAsync(`${consultationsPrefix}/${plan.from}`);

        ctx.summary.renames += 1;
        await syncDb.appendLogAsync(
            "renamed",
            `Consultation ${plan.from} → ${plan.to} for patient ${pid} (renumbered after merging visits).`,
        );
    }

    ctx.touchedPatients.add(pid);
    ctx.summary.structuralChange = true;
    // Everything under this patient's consultations is in flux; the chained cycle
    // reconciles it against a fresh listing.
    ctx.skipPrefixes.push(consultationsPrefix);

    await syncDb.appendLogAsync(
        "renamed",
        `Consultation ID ${collidingCid} of patient ${pid} was used on two devices; both visits were kept and renumbered.`,
    );
};
