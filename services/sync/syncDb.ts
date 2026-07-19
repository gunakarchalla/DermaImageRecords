import * as Crypto from "expo-crypto";
import * as SQLite from "expo-sqlite";

/**
 * Durable sync bookkeeping — a separate database from the disposable `derma-index.db`,
 * because none of this can be rebuilt from disk:
 *
 * - `sync_state`: per-relPath record of what was last synced (Drive file id + content
 *   fingerprints on both sides). The three-way diff compares local vs remote vs this.
 * - `tombstones`: deletions made through the app, pending/announced to other devices.
 * - `sync_log`: the user-visible sync report (conflicts, renames, heals, errors).
 * - `sync_meta`: root folder id, device id, last-sync timestamps, applied-tombstone marks.
 */

const DB_NAME = "derma-sync.db";
const DB_SCHEMA_VERSION = 1;

export type SyncStateRow = {
    relPath: string;
    driveFileId: string;
    /** Drive md5Checksum at last sync (null for folders). */
    remoteMd5: string | null;
    /** Fingerprint of the local content at last sync (JSON files only; null for photos/folders). */
    localFingerprint: string | null;
    isDir: boolean;
    syncedAt: string;
};

export type TombstoneKind = "patient" | "consultation" | "photo";

export type TombstoneRow = {
    relPath: string;
    kind: TombstoneKind;
    uid: string;
    deletedAt: string;
    /** Set once announced in this device's remote tombstone file. */
    uploadedAt: string | null;
};

export type SyncLogLevel = "info" | "conflict" | "renamed" | "error";

export type SyncLogRow = {
    id: number;
    at: string;
    level: SyncLogLevel;
    message: string;
};

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;
let schemaReadyPromise: Promise<void> | null = null;

const openDbAsync = async (): Promise<SQLite.SQLiteDatabase> => {
    if (!dbPromise) dbPromise = SQLite.openDatabaseAsync(DB_NAME);
    return dbPromise;
};

const ensureSchemaAsync = async () => {
    if (schemaReadyPromise) return schemaReadyPromise;

    schemaReadyPromise = (async () => {
        const db = await openDbAsync();
        await db.execAsync("PRAGMA journal_mode=WAL;");

        const versionRow = await db.getFirstAsync<{ user_version: number }>("PRAGMA user_version");
        if ((versionRow?.user_version ?? 0) !== DB_SCHEMA_VERSION) {
            await db.execAsync(
                `
                DROP TABLE IF EXISTS sync_state;
                DROP TABLE IF EXISTS tombstones;
                DROP TABLE IF EXISTS sync_log;
                DROP TABLE IF EXISTS sync_meta;
            `
            );
        }

        await db.execAsync(
            `
            CREATE TABLE IF NOT EXISTS sync_state (
                relPath TEXT PRIMARY KEY NOT NULL,
                driveFileId TEXT NOT NULL,
                remoteMd5 TEXT,
                localFingerprint TEXT,
                isDir INTEGER NOT NULL DEFAULT 0,
                syncedAt TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS tombstones (
                relPath TEXT PRIMARY KEY NOT NULL,
                kind TEXT NOT NULL,
                uid TEXT NOT NULL,
                deletedAt TEXT NOT NULL,
                uploadedAt TEXT
            );

            CREATE TABLE IF NOT EXISTS sync_log (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                at TEXT NOT NULL,
                level TEXT NOT NULL,
                message TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS sync_meta (
                key TEXT PRIMARY KEY NOT NULL,
                value TEXT NOT NULL
            );
        `
        );

        if ((versionRow?.user_version ?? 0) !== DB_SCHEMA_VERSION) {
            await db.execAsync(`PRAGMA user_version = ${DB_SCHEMA_VERSION};`);
        }
    })();

    return schemaReadyPromise;
};

export const syncDb = {
    // ---- meta ----

    getMetaAsync: async (key: string): Promise<string | null> => {
        await ensureSchemaAsync();
        const db = await openDbAsync();
        const row = await db.getFirstAsync<{ value: string }>(
            "SELECT value FROM sync_meta WHERE key = ?",
            [key],
        );
        return row?.value ?? null;
    },

    setMetaAsync: async (key: string, value: string) => {
        await ensureSchemaAsync();
        const db = await openDbAsync();
        await db.runAsync(
            "INSERT INTO sync_meta(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            [key, value],
        );
    },

    deleteMetaAsync: async (key: string) => {
        await ensureSchemaAsync();
        const db = await openDbAsync();
        await db.runAsync("DELETE FROM sync_meta WHERE key = ?", [key]);
    },

    /** Stable per-install device id, minted on first use. */
    getOrCreateDeviceIdAsync: async (): Promise<string> => {
        const existing = await syncDb.getMetaAsync("deviceId");
        if (existing) return existing;
        const deviceId = Crypto.randomUUID().slice(0, 13);
        await syncDb.setMetaAsync("deviceId", deviceId);
        return deviceId;
    },

    // ---- sync_state ----

    readAllStateAsync: async (): Promise<Map<string, SyncStateRow>> => {
        await ensureSchemaAsync();
        const db = await openDbAsync();
        const rows = await db.getAllAsync<{
            relPath: string;
            driveFileId: string;
            remoteMd5: string | null;
            localFingerprint: string | null;
            isDir: number;
            syncedAt: string;
        }>("SELECT * FROM sync_state");
        const map = new Map<string, SyncStateRow>();
        for (const r of rows) {
            map.set(r.relPath, { ...r, isDir: r.isDir === 1 });
        }
        return map;
    },

    upsertStateAsync: async (row: SyncStateRow) => {
        await ensureSchemaAsync();
        const db = await openDbAsync();
        await db.runAsync(
            `
            INSERT INTO sync_state(relPath, driveFileId, remoteMd5, localFingerprint, isDir, syncedAt)
            VALUES(?, ?, ?, ?, ?, ?)
            ON CONFLICT(relPath) DO UPDATE SET
                driveFileId = excluded.driveFileId,
                remoteMd5 = excluded.remoteMd5,
                localFingerprint = excluded.localFingerprint,
                isDir = excluded.isDir,
                syncedAt = excluded.syncedAt
        `,
            [row.relPath, row.driveFileId, row.remoteMd5, row.localFingerprint, row.isDir ? 1 : 0, row.syncedAt],
        );
    },

    deleteStateAsync: async (relPath: string) => {
        await ensureSchemaAsync();
        const db = await openDbAsync();
        await db.runAsync("DELETE FROM sync_state WHERE relPath = ?", [relPath]);
    },

    /** Drop every state row at or under `prefix` (a folder's subtree). */
    deleteStateByPrefixAsync: async (prefix: string) => {
        await ensureSchemaAsync();
        const db = await openDbAsync();
        await db.runAsync("DELETE FROM sync_state WHERE relPath = ? OR relPath LIKE ?", [
            prefix,
            `${prefix}/%`,
        ]);
    },

    // ---- tombstones ----

    recordTombstoneAsync: async (relPath: string, kind: TombstoneKind, uid: string) => {
        await ensureSchemaAsync();
        const db = await openDbAsync();
        await db.runAsync(
            `
            INSERT INTO tombstones(relPath, kind, uid, deletedAt, uploadedAt)
            VALUES(?, ?, ?, ?, NULL)
            ON CONFLICT(relPath) DO UPDATE SET
                kind = excluded.kind,
                uid = excluded.uid,
                deletedAt = excluded.deletedAt,
                uploadedAt = NULL
        `,
            [relPath, kind, uid, new Date().toISOString()],
        );
    },

    readAllTombstonesAsync: async (): Promise<TombstoneRow[]> => {
        await ensureSchemaAsync();
        const db = await openDbAsync();
        return db.getAllAsync<TombstoneRow>("SELECT * FROM tombstones");
    },

    markTombstonesUploadedAsync: async (relPaths: readonly string[]) => {
        if (relPaths.length === 0) return;
        await ensureSchemaAsync();
        const db = await openDbAsync();
        const now = new Date().toISOString();
        await db.withExclusiveTransactionAsync(async (txn) => {
            for (const relPath of relPaths) {
                await txn.runAsync("UPDATE tombstones SET uploadedAt = ? WHERE relPath = ?", [now, relPath]);
            }
        });
    },

    // ---- sync_log ----

    appendLogAsync: async (level: SyncLogLevel, message: string) => {
        await ensureSchemaAsync();
        const db = await openDbAsync();
        await db.runAsync("INSERT INTO sync_log(at, level, message) VALUES(?, ?, ?)", [
            new Date().toISOString(),
            level,
            message,
        ]);
        // Keep the report bounded.
        await db.runAsync(
            "DELETE FROM sync_log WHERE id NOT IN (SELECT id FROM sync_log ORDER BY id DESC LIMIT 200)",
        );
    },

    readRecentLogAsync: async (limit: number): Promise<SyncLogRow[]> => {
        await ensureSchemaAsync();
        const db = await openDbAsync();
        return db.getAllAsync<SyncLogRow>(
            "SELECT * FROM sync_log ORDER BY id DESC LIMIT ?",
            [limit],
        );
    },

    clearLogAsync: async () => {
        await ensureSchemaAsync();
        const db = await openDbAsync();
        await db.runAsync("DELETE FROM sync_log");
    },

    // ---- lifecycle ----

    /** Device-only wipe: forget everything, including the device identity. */
    clearAllAsync: async () => {
        await ensureSchemaAsync();
        const db = await openDbAsync();
        await db.withExclusiveTransactionAsync(async (txn) => {
            await txn.execAsync(
                `
                DELETE FROM sync_state;
                DELETE FROM tombstones;
                DELETE FROM sync_log;
                DELETE FROM sync_meta;
            `
            );
        });
    },
};
