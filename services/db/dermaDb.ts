import * as SQLite from "expo-sqlite";

import type { Consultation, ConsultationIndexRow, Patient } from "../../types/models";

// NOTE: SQLite is a rebuildable index only. The filesystem remains the source-of-truth.
// We keep this layer minimal and defensive: callers can always rebuild from disk.

const DB_NAME = "derma-index.db";

/**
 * Bump whenever the table shape changes. The index is rebuildable from disk, so a mismatch is
 * resolved by dropping everything rather than by migrating: clearing `meta` leaves
 * `patients.lastReindexAt` unset, which makes `ensurePatientsIndexAsync` do a full rebuild.
 *
 * v2: the EMR number became the patient's identity, so `patients.id` *is* the EMR and the
 * separate `emrNumber` / `emrNumberSort` columns were dropped.
 * v3: consultations gained a per-patient sequence `number`, which orders the list and drives
 * pagination; patients gained `lastConsultationNumber`.
 */
const DB_SCHEMA_VERSION = 3;

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;
let schemaReadyPromise: Promise<void> | null = null;

const openDbAsync = async (): Promise<SQLite.SQLiteDatabase> => {
    if (!dbPromise) {
        dbPromise = SQLite.openDatabaseAsync(DB_NAME);
    }
    return dbPromise;
};

const ensureSchemaAsync = async () => {
    if (schemaReadyPromise) return schemaReadyPromise;

    schemaReadyPromise = (async () => {
        const db = await openDbAsync();

        // Pragmas help performance + data integrity.
        await db.execAsync("PRAGMA journal_mode=WAL;");
        await db.execAsync("PRAGMA foreign_keys=ON;");

        // `user_version` avoids a chicken-and-egg with the `meta` table, which we may drop below.
        const versionRow = await db.getFirstAsync<{ user_version: number }>("PRAGMA user_version");
        const installedVersion = versionRow?.user_version ?? 0;

        if (installedVersion !== DB_SCHEMA_VERSION) {
            await db.execAsync(
                `
                DROP TABLE IF EXISTS consultations;
                DROP TABLE IF EXISTS patients;
                DROP TABLE IF EXISTS meta;
            `
            );
        }

        await db.execAsync(
            `
            CREATE TABLE IF NOT EXISTS meta (
                key TEXT PRIMARY KEY NOT NULL,
                value TEXT NOT NULL
            );

            -- \`id\` is the canonical EMR number (see types/models.ts). The primary key is
            -- therefore the uniqueness constraint on the EMR; no separate column is needed.
            CREATE TABLE IF NOT EXISTS patients (
                id TEXT PRIMARY KEY NOT NULL,
                name TEXT NOT NULL,
                nameSort TEXT NOT NULL,
                age INTEGER,
                gender TEXT,
                phone TEXT,
                profilePhotoUri TEXT,
                lastConsultationNumber INTEGER NOT NULL DEFAULT 0,
                createdAt TEXT NOT NULL,
                updatedAt TEXT NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_patients_updatedAt ON patients(updatedAt);
            CREATE INDEX IF NOT EXISTS idx_patients_createdAt ON patients(createdAt);
            CREATE INDEX IF NOT EXISTS idx_patients_nameSort ON patients(nameSort);

            -- \`id\` is the zero-padded spelling of \`number\`, and the consultation's folder
            -- name. Ordering and pagination use the integer \`number\`, never the padded text.
            CREATE TABLE IF NOT EXISTS consultations (
                id TEXT NOT NULL,
                number INTEGER NOT NULL,
                patientId TEXT NOT NULL,
                remarks TEXT NOT NULL,
                photoCount INTEGER NOT NULL,
                createdAt TEXT NOT NULL,
                updatedAt TEXT NOT NULL,
                PRIMARY KEY (patientId, id)
            );

            CREATE INDEX IF NOT EXISTS idx_consultations_patient_number ON consultations(patientId, number);
        `
        );

        if (installedVersion !== DB_SCHEMA_VERSION) {
            // Not parameterizable — the value is a literal we control.
            await db.execAsync(`PRAGMA user_version = ${DB_SCHEMA_VERSION};`);
        }
    })();

    return schemaReadyPromise;
};

const normalizeSortText = (value: string | null | undefined) => (value ?? "").trim().toLowerCase();

export type PatientSortField = "updatedAt" | "createdAt" | "name";
export type SortDirection = "asc" | "desc";

export type PatientCursor = {
    sortValue: string;
    id: string;
};

/** Keyset cursor for a patient's consultations. `number` is unique per patient, so it alone
 *  gives a stable total order — no tiebreak column is needed. */
export type ConsultationCursor = {
    number: number;
};

export const dermaDb = {
    ensureReadyAsync: async () => {
        await ensureSchemaAsync();
        return openDbAsync();
    },

    getMetaAsync: async (key: string): Promise<string | null> => {
        await ensureSchemaAsync();
        const db = await openDbAsync();
        const row = await db.getFirstAsync<{ value: string }>("SELECT value FROM meta WHERE key = ?", [key]);
        return row?.value ?? null;
    },

    setMetaAsync: async (key: string, value: string) => {
        await ensureSchemaAsync();
        const db = await openDbAsync();
        await db.runAsync(
            "INSERT INTO meta(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            [key, value]
        );
    },

    deleteMetaByPrefixAsync: async (prefix: string) => {
        await ensureSchemaAsync();
        const db = await openDbAsync();
        await db.runAsync("DELETE FROM meta WHERE key LIKE ?", [`${prefix}%`]);
    },

    clearAllAsync: async () => {
        await ensureSchemaAsync();
        const db = await openDbAsync();
        // Use an exclusive transaction to prevent interleaving with readers/writers.
        await db.withExclusiveTransactionAsync(async (txn) => {
            await txn.execAsync(
                `
                DELETE FROM consultations;
                DELETE FROM patients;
                DELETE FROM meta;
            `
            );
        });
    },

    upsertPatientAsync: async (patient: Patient) => {
        await ensureSchemaAsync();
        const db = await openDbAsync();
        // Exclusive transaction keeps writes deterministic under concurrent access.
        await db.withExclusiveTransactionAsync(async (txn) => {
            await txn.runAsync(
                `
                INSERT INTO patients(
                    id, name, nameSort, age, gender, phone, profilePhotoUri, lastConsultationNumber, createdAt, updatedAt
                ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                    name = excluded.name,
                    nameSort = excluded.nameSort,
                    age = excluded.age,
                    gender = excluded.gender,
                    phone = excluded.phone,
                    profilePhotoUri = excluded.profilePhotoUri,
                    lastConsultationNumber = excluded.lastConsultationNumber,
                    createdAt = excluded.createdAt,
                    updatedAt = excluded.updatedAt
            `,
                [
                    patient.id,
                    patient.name,
                    normalizeSortText(patient.name),
                    patient.age ?? null,
                    patient.gender ?? null,
                    patient.phone ?? null,
                    patient.profilePhotoUri ?? null,
                    patient.lastConsultationNumber,
                    patient.createdAt,
                    patient.updatedAt,
                ]
            );
        });
    },

    deletePatientAsync: async (patientId: string) => {
        await ensureSchemaAsync();
        const db = await openDbAsync();
        await db.withExclusiveTransactionAsync(async (txn) => {
            await txn.runAsync("DELETE FROM consultations WHERE patientId = ?", [patientId]);
            await txn.runAsync("DELETE FROM patients WHERE id = ?", [patientId]);
        });
    },

    queryPatientsPageAsync: async (input: {
        limit: number;
        search?: string;
        sortField: PatientSortField;
        sortDirection: SortDirection;
        cursor?: PatientCursor;
    }): Promise<{ items: Patient[]; nextCursor?: PatientCursor }> => {
        await ensureSchemaAsync();
        const db = await openDbAsync();

        const search = input.search?.trim().toLowerCase() ?? "";
        const hasSearch = search.length > 0;
        const direction = input.sortDirection.toUpperCase() as "ASC" | "DESC";

        const sortExpr =
            input.sortField === "name"
                ? "nameSort"
                : input.sortField === "createdAt"
                    ? "createdAt"
                    : "updatedAt";

        const where: string[] = [];
        const args: (string | number | null)[] = [];

        if (hasSearch) {
            // `id` is the canonical (uppercase) EMR and `search` is lowercased, so match on
            // LOWER(id). A `%…%` pattern can't use an index anyway, so no stored sort column.
            where.push("(nameSort LIKE ? OR LOWER(id) LIKE ?)");
            const pattern = `%${search}%`;
            args.push(pattern, pattern);
        }

        if (input.cursor) {
            // Cursor-based pagination for stable ordering.
            // For DESC: load rows with sortExpr < cursor.sortValue, or equal and id < cursor.id
            // For ASC: sortExpr > cursor.sortValue, or equal and id > cursor.id
            if (direction === "DESC") {
                where.push(`(${sortExpr} < ? OR (${sortExpr} = ? AND id < ?))`);
            } else {
                where.push(`(${sortExpr} > ? OR (${sortExpr} = ? AND id > ?))`);
            }
            args.push(input.cursor.sortValue, input.cursor.sortValue, input.cursor.id);
        }

        const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

        const rows = await db.getAllAsync<{
            id: string;
            name: string;
            age: number | null;
            gender: string | null;
            phone: string | null;
            profilePhotoUri: string | null;
            lastConsultationNumber: number;
            createdAt: string;
            updatedAt: string;
            nameSort: string;
        }>(
            `
            SELECT id, name, age, gender, phone, profilePhotoUri, lastConsultationNumber, createdAt, updatedAt, nameSort
            FROM patients
            ${whereSql}
            ORDER BY ${sortExpr} ${direction}, id ${direction}
            LIMIT ?
        `,
            [...args, input.limit]
        );

        const items: Patient[] = rows.map((r) => ({
            id: r.id,
            emrNumber: r.id, // the id *is* the EMR; see types/models.ts
            name: r.name,
            age: r.age ?? undefined,
            gender: (r.gender as Patient["gender"]) ?? undefined,
            phone: r.phone ?? undefined,
            profilePhotoUri: r.profilePhotoUri ?? undefined,
            lastConsultationNumber: r.lastConsultationNumber,
            createdAt: r.createdAt,
            updatedAt: r.updatedAt,
        }));

        const last = rows.at(-1);
        const nextCursor =
            last && items.length === input.limit
                ? {
                    sortValue: sortExpr === "nameSort" ? last.nameSort : sortExpr === "createdAt" ? last.createdAt : last.updatedAt,
                    id: last.id,
                }
                : undefined;

        return { items, nextCursor };
    },

    upsertConsultationAsync: async (consultation: Consultation) => {
        await ensureSchemaAsync();
        const db = await openDbAsync();
        await db.withExclusiveTransactionAsync(async (txn) => {
            await txn.runAsync(
                `
                INSERT INTO consultations(id, number, patientId, remarks, photoCount, createdAt, updatedAt)
                VALUES(?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(patientId, id) DO UPDATE SET
                    number = excluded.number,
                    remarks = excluded.remarks,
                    photoCount = excluded.photoCount,
                    createdAt = excluded.createdAt,
                    updatedAt = excluded.updatedAt
            `,
                [
                    consultation.id,
                    consultation.number,
                    consultation.patientId,
                    consultation.remarks,
                    consultation.photoUris.length,
                    consultation.createdAt,
                    consultation.updatedAt,
                ]
            );
        });
    },

    deleteConsultationAsync: async (patientId: string, consultationId: string) => {
        await ensureSchemaAsync();
        const db = await openDbAsync();
        await db.withExclusiveTransactionAsync(async (txn) => {
            await txn.runAsync("DELETE FROM consultations WHERE patientId = ? AND id = ?", [patientId, consultationId]);
        });
    },

    deleteConsultationsByPatientAsync: async (patientId: string) => {
        await ensureSchemaAsync();
        const db = await openDbAsync();
        await db.withExclusiveTransactionAsync(async (txn) => {
            await txn.runAsync("DELETE FROM consultations WHERE patientId = ?", [patientId]);
        });
    },

    queryConsultationsPageAsync: async (input: {
        patientId: string;
        limit: number;
        cursor?: ConsultationCursor;
    }): Promise<{ items: ConsultationIndexRow[]; nextCursor?: ConsultationCursor }> => {
        await ensureSchemaAsync();
        const db = await openDbAsync();

        const where: string[] = ["patientId = ?"];
        const args: (string | number)[] = [input.patientId];

        if (input.cursor) {
            where.push("number < ?");
            args.push(input.cursor.number);
        }

        const rows = await db.getAllAsync<{
            id: string;
            number: number;
            patientId: string;
            remarks: string;
            photoCount: number;
            createdAt: string;
            updatedAt: string;
        }>(
            `
            SELECT id, number, patientId, remarks, photoCount, createdAt, updatedAt
            FROM consultations
            WHERE ${where.join(" AND ")}
            ORDER BY number DESC
            LIMIT ?
        `,
            [...args, input.limit]
        );

        const items: ConsultationIndexRow[] = rows.map((r) => ({
            id: r.id,
            number: r.number,
            patientId: r.patientId,
            remarks: r.remarks,
            photoCount: r.photoCount,
            createdAt: r.createdAt,
            updatedAt: r.updatedAt,
        }));

        const last = rows.at(-1);
        const nextCursor = last && items.length === input.limit ? { number: last.number } : undefined;

        return { items, nextCursor };
    },
};
