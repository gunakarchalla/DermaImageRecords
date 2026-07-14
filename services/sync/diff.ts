/**
 * The pure three-way diff at the heart of sync: local tree vs remote tree vs the
 * last-synced state. No I/O — inputs are plain maps, output is a list of actions for
 * the applier. Tombstones are consumed BEFORE this runs (the engine trashes remote
 * paths and drops their state), so by the time diff sees the maps, every "vanished"
 * side is either honest tampering to heal or a fresh add/download.
 *
 * Photos are immutable-by-name: present on both sides ⇒ in sync (content is never
 * compared). JSON files carry fingerprints; a change on either side since last sync
 * routes to `reconcileJson`, where the applier resolves with full content in hand
 * (LWW by updatedAt, uid collision handling).
 */

export type DiffLocalNode = {
    isDir: boolean;
    /** md5 of JSON content; null for photos/folders (and unreadable JSONs). */
    jsonFingerprint: string | null;
};

export type DiffRemoteNode = {
    id: string;
    isDir: boolean;
    md5: string | null;
};

export type DiffStateRow = {
    driveFileId: string;
    remoteMd5: string | null;
    localFingerprint: string | null;
    isDir: boolean;
};

export type SyncAction =
    | { kind: "createRemoteDir"; relPath: string }
    | { kind: "upload"; relPath: string }
    | { kind: "reuploadMissing"; relPath: string }
    | { kind: "download"; relPath: string; fileId: string }
    | { kind: "redownloadMissing"; relPath: string; fileId: string }
    | { kind: "uploadJsonChanged"; relPath: string; fileId: string }
    | { kind: "downloadJsonChanged"; relPath: string; fileId: string }
    | { kind: "reconcileJson"; relPath: string; fileId: string }
    | { kind: "adoptState"; relPath: string; fileId: string; remoteMd5: string | null; localFingerprint: string | null; isDir: boolean }
    | { kind: "dropState"; relPath: string };

const isJsonPath = (relPath: string) => relPath.toLowerCase().endsWith(".json");

export const diffTrees = (
    local: ReadonlyMap<string, DiffLocalNode>,
    remote: ReadonlyMap<string, DiffRemoteNode>,
    state: ReadonlyMap<string, DiffStateRow>,
): SyncAction[] => {
    const actions: SyncAction[] = [];
    const allPaths = new Set<string>([...local.keys(), ...remote.keys(), ...state.keys()]);

    for (const relPath of allPaths) {
        const l = local.get(relPath);
        const r = remote.get(relPath);
        const s = state.get(relPath);

        // ---- folders: only remote creation and state hygiene matter. Local folders
        // materialize implicitly when files download; remote leftover folders get
        // trashed by the tombstone pass, never here.
        if (l?.isDir || r?.isDir || s?.isDir) {
            if (l?.isDir && !r) {
                actions.push({ kind: "createRemoteDir", relPath });
            } else if (l?.isDir && r?.isDir && !s) {
                actions.push({
                    kind: "adoptState",
                    relPath,
                    fileId: r.id,
                    remoteMd5: null,
                    localFingerprint: null,
                    isDir: true,
                });
            } else if (!l && !r && s) {
                actions.push({ kind: "dropState", relPath });
            }
            continue;
        }

        if (l && !r) {
            // New local file, or the remote copy vanished without a tombstone (Drive-UI
            // tampering) — both heal by uploading.
            actions.push(s ? { kind: "reuploadMissing", relPath } : { kind: "upload", relPath });
            continue;
        }

        if (!l && r) {
            // New remote file, or the local copy vanished without an app deletion
            // (file-manager tampering) — both heal by downloading.
            actions.push(
                s
                    ? { kind: "redownloadMissing", relPath, fileId: r.id }
                    : { kind: "download", relPath, fileId: r.id },
            );
            continue;
        }

        if (l && r) {
            if (!isJsonPath(relPath)) {
                // Photo present on both sides: in sync by construction.
                if (!s || s.driveFileId !== r.id) {
                    actions.push({
                        kind: "adoptState",
                        relPath,
                        fileId: r.id,
                        remoteMd5: r.md5,
                        localFingerprint: null,
                        isDir: false,
                    });
                }
                continue;
            }

            const changedLocal = !s || l.jsonFingerprint === null || l.jsonFingerprint !== s.localFingerprint;
            const changedRemote = !s || (r.md5 ?? null) !== s.remoteMd5;

            if (changedLocal && changedRemote) {
                // Both sides moved (or first pairing): needs content-level resolution.
                actions.push({ kind: "reconcileJson", relPath, fileId: r.id });
            } else if (changedLocal) {
                actions.push({ kind: "uploadJsonChanged", relPath, fileId: r.id });
            } else if (changedRemote) {
                actions.push({ kind: "downloadJsonChanged", relPath, fileId: r.id });
            } else if (s && s.driveFileId !== r.id) {
                // Same content, new remote identity (deleted + re-uploaded elsewhere).
                actions.push({
                    kind: "adoptState",
                    relPath,
                    fileId: r.id,
                    remoteMd5: r.md5,
                    localFingerprint: l.jsonFingerprint,
                    isDir: false,
                });
            }
            continue;
        }

        // Neither side has it any more.
        if (s) actions.push({ kind: "dropState", relPath });
    }

    return actions;
};
