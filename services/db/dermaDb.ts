import * as SQLite from "expo-sqlite";

import type {
    Consultation,
    ConsultationIndexRow,
    Patient,
    PhotoIndexRow,
} from "../../types/models";

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
 * v4: consultation identity moved to a `createdAt`-derived timestamp id; the stored `number`
 * column and `patients.lastConsultationNumber` were dropped. The visit number is now a derived
 * ordinal over `createdAt`, and consultations order/paginate by `createdAt`.
 * v5 (data model v2): records gained immutable `uid`s; patients gained `profileThumbUri`;
 * a new `photos` table (with a precomputed `sortKey` for keyset paging) powers the gallery.
 * URI columns hold *resolved* device-local URIs — the portable truth on disk is relative.
 */
const DB_SCHEMA_VERSION = 5;

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
                DROP TABLE IF EXISTS photos;
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
                uid TEXT NOT NULL,
                name TEXT NOT NULL,
                nameSort TEXT NOT NULL,
                age INTEGER,
                gender TEXT,
                phone TEXT,
                profilePhotoUri TEXT,
                profileThumbUri TEXT,
                createdAt TEXT NOT NULL,
                updatedAt TEXT NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_patients_updatedAt ON patients(updatedAt);
            CREATE INDEX IF NOT EXISTS idx_patients_createdAt ON patients(createdAt);
            CREATE INDEX IF NOT EXISTS idx_patients_nameSort ON patients(nameSort);

            -- \`id\` is the consultation's CID and its folder name. Ordering and pagination
            -- use \`createdAt\`; the visit number shown in the UI is a derived ordinal
            -- computed at query time, not a stored column.
            CREATE TABLE IF NOT EXISTS consultations (
                id TEXT NOT NULL,
                patientId TEXT NOT NULL,
                uid TEXT NOT NULL,
                remarks TEXT NOT NULL,
                photoCount INTEGER NOT NULL,
                createdAt TEXT NOT NULL,
                updatedAt TEXT NOT NULL,
                PRIMARY KEY (patientId, id)
            );

            CREATE INDEX IF NOT EXISTS idx_consultations_patient_createdAt ON consultations(patientId, createdAt);

            -- Gallery feed. Rows are replaced wholesale per consultation on every save.
            -- \`sortKey\` precomputes the newest-first ordering (capturedAt + tiebreaks) so
            -- keyset pagination is a single-column comparison.
            CREATE TABLE IF NOT EXISTS photos (
                patientId TEXT NOT NULL,
                consultationId TEXT NOT NULL,
                uid TEXT NOT NULL,
                file TEXT NOT NULL,
                position INTEGER NOT NULL,
                uri TEXT NOT NULL,
                thumbUri TEXT,
                capturedAt TEXT NOT NULL,
                sortKey TEXT NOT NULL,
                PRIMARY KEY (patientId, consultationId, file)
            );

            CREATE INDEX IF NOT EXISTS idx_photos_sortKey ON photos(sortKey);
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

/** Keyset cursor for a patient's consultations. `createdAt` orders the list; `id` is the
 *  tiebreak for the rare same-instant pair. */
export type ConsultationCursor = {
    createdAt: string;
    id: string;
};

/** Keyset cursor for the gallery feed: the last row's precomputed `sortKey`. */
export type PhotoCursor = {
    sortKey: string;
};

/**
 * Single-column ordering key for the photo feed: newest capture first, with stable
 * tiebreaks. ISO timestamps sort lexically; the position is zero-padded so it does too.
 */
const photoSortKey = (capturedAt: string, patientId: string, consultationId: string, position: number) =>
    `${capturedAt}|${patientId}|${consultationId}|${String(position).padStart(4, "0")}`;

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
                DELETE FROM photos;
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
                    id, uid, name, nameSort, age, gender, phone,
                    profilePhotoUri, profileThumbUri, createdAt, updatedAt
                ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                    uid = excluded.uid,
                    name = excluded.name,
                    nameSort = excluded.nameSort,
                    age = excluded.age,
                    gender = excluded.gender,
                    phone = excluded.phone,
                    profilePhotoUri = excluded.profilePhotoUri,
                    profileThumbUri = excluded.profileThumbUri,
                    createdAt = excluded.createdAt,
                    updatedAt = excluded.updatedAt
            `,
                [
                    patient.id,
                    patient.uid,
                    patient.name,
                    normalizeSortText(patient.name),
                    patient.age ?? null,
                    patient.gender ?? null,
                    patient.phone ?? null,
                    patient.profilePhotoUri ?? null,
                    patient.profileThumbUri ?? null,
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
            await txn.runAsync("DELETE FROM photos WHERE patientId = ?", [patientId]);
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
            uid: string;
            name: string;
            age: number | null;
            gender: string | null;
            phone: string | null;
            profilePhotoUri: string | null;
            profileThumbUri: string | null;
            createdAt: string;
            updatedAt: string;
            nameSort: string;
        }>(
            `
            SELECT id, uid, name, age, gender, phone, profilePhotoUri, profileThumbUri,
                   createdAt, updatedAt, nameSort
            FROM patients
            ${whereSql}
            ORDER BY ${sortExpr} ${direction}, id ${direction}
            LIMIT ?
        `,
            [...args, input.limit]
        );

        const items: Patient[] = rows.map((r) => ({
            schema: 2,
            uid: r.uid,
            id: r.id,
            emrNumber: r.id, // the id *is* the EMR; see types/models.ts
            name: r.name,
            age: r.age ?? undefined,
            gender: (r.gender as Patient["gender"]) ?? undefined,
            phone: r.phone ?? undefined,
            profilePhotoUri: r.profilePhotoUri ?? undefined,
            profileThumbUri: r.profileThumbUri ?? undefined,
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
                INSERT INTO consultations(id, patientId, uid, remarks, photoCount, createdAt, updatedAt)
                VALUES(?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(patientId, id) DO UPDATE SET
                    uid = excluded.uid,
                    remarks = excluded.remarks,
                    photoCount = excluded.photoCount,
                    createdAt = excluded.createdAt,
                    updatedAt = excluded.updatedAt
            `,
                [
                    consultation.id,
                    consultation.patientId,
                    consultation.uid,
                    consultation.remarks,
                    consultation.photoUris.length,
                    consultation.createdAt,
                    consultation.updatedAt,
                ]
            );

            // Photo rows are replaced wholesale: the consultation's photo list is small and
            // this keeps positions/URIs exact after any add/remove/edit.
            await txn.runAsync("DELETE FROM photos WHERE patientId = ? AND consultationId = ?", [
                consultation.patientId,
                consultation.id,
            ]);
            for (let position = 0; position < consultation.photos.length; position += 1) {
                const entry = consultation.photos[position];
                await txn.runAsync(
                    `
                    INSERT INTO photos(
                        patientId, consultationId, uid, file, position, uri, thumbUri, capturedAt, sortKey
                    ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)
                `,
                    [
                        consultation.patientId,
                        consultation.id,
                        entry.uid,
                        entry.file,
                        position,
                        consultation.photoUris[position],
                        consultation.thumbUris[position],
                        entry.capturedAt,
                        photoSortKey(entry.capturedAt, consultation.patientId, consultation.id, position),
                    ]
                );
            }
        });
    },

    deleteConsultationAsync: async (patientId: string, consultationId: string) => {
        await ensureSchemaAsync();
        const db = await openDbAsync();
        await db.withExclusiveTransactionAsync(async (txn) => {
            await txn.runAsync("DELETE FROM photos WHERE patientId = ? AND consultationId = ?", [patientId, consultationId]);
            await txn.runAsync("DELETE FROM consultations WHERE patientId = ? AND id = ?", [patientId, consultationId]);
        });
    },

    deleteConsultationsByPatientAsync: async (patientId: string) => {
        await ensureSchemaAsync();
        const db = await openDbAsync();
        await db.withExclusiveTransactionAsync(async (txn) => {
            await txn.runAsync("DELETE FROM photos WHERE patientId = ?", [patientId]);
            await txn.runAsync("DELETE FROM consultations WHERE patientId = ?", [patientId]);
        });
    },

    /**
     * Newest-first page of the global photo feed. Keyset pagination on the precomputed
     * `sortKey`, so a page is one indexed range scan regardless of dataset size.
     */
    queryPhotosPageAsync: async (input: {
        limit: number;
        cursor?: PhotoCursor;
    }): Promise<{ items: PhotoIndexRow[]; nextCursor?: PhotoCursor }> => {
        await ensureSchemaAsync();
        const db = await openDbAsync();

        const args: (string | number)[] = [];
        let whereSql = "";
        if (input.cursor) {
            whereSql = "WHERE sortKey < ?";
            args.push(input.cursor.sortKey);
        }

        const rows = await db.getAllAsync<{
            patientId: string;
            consultationId: string;
            uid: string;
            file: string;
            position: number;
            uri: string;
            thumbUri: string | null;
            capturedAt: string;
            sortKey: string;
        }>(
            `
            SELECT patientId, consultationId, uid, file, position, uri, thumbUri, capturedAt, sortKey
            FROM photos
            ${whereSql}
            ORDER BY sortKey DESC
            LIMIT ?
        `,
            [...args, input.limit]
        );

        const items: PhotoIndexRow[] = rows.map((r) => ({
            patientId: r.patientId,
            consultationId: r.consultationId,
            uid: r.uid,
            file: r.file,
            position: r.position,
            uri: r.uri,
            thumbUri: r.thumbUri,
            capturedAt: r.capturedAt,
        }));

        const last = rows.at(-1);
        const nextCursor =
            last && rows.length === input.limit ? { sortKey: last.sortKey } : undefined;

        return { items, nextCursor };
    },

    queryConsultationsPageAsync: async (input: {
        patientId: string;
        limit: number;
        cursor?: ConsultationCursor;
    }): Promise<{ items: ConsultationIndexRow[]; nextCursor?: ConsultationCursor }> => {
        await ensureSchemaAsync();
        const db = await openDbAsync();

        // The display number is the row's position over `createdAt ASC` across the patient's whole
        // set, so it must be computed *before* the cursor filter narrows the page — hence the
        // window function in an inner query, with pagination applied on the outside. Pages come
        // back newest-first (createdAt DESC), keyset-paginated on (createdAt, id).
        const args: (string | number)[] = [input.patientId];
        let cursorSql = "";
        if (input.cursor) {
            cursorSql = "WHERE (createdAt < ? OR (createdAt = ? AND id < ?))";
            args.push(input.cursor.createdAt, input.cursor.createdAt, input.cursor.id);
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
            FROM (
                SELECT id, patientId, remarks, photoCount, createdAt, updatedAt,
                       ROW_NUMBER() OVER (ORDER BY createdAt ASC, id ASC) AS number
                FROM consultations
                WHERE patientId = ?
            )
            ${cursorSql}
            ORDER BY createdAt DESC, id DESC
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
        const nextCursor =
            last && items.length === input.limit
                ? { createdAt: last.createdAt, id: last.id }
                : undefined;

        return { items, nextCursor };
    },

    /**
     * The derived display number for a single consultation (its position over `createdAt ASC`
     * among the patient's visits), or null if the row is not indexed. Used by the detail screen,
     * which loads the consultation file (no stored number) and needs the ordinal for its heading.
     */
    getConsultationNumberAsync: async (patientId: string, id: string): Promise<number | null> => {
        await ensureSchemaAsync();
        const db = await openDbAsync();
        const row = await db.getFirstAsync<{ number: number }>(
            `
            SELECT number FROM (
                SELECT id, ROW_NUMBER() OVER (ORDER BY createdAt ASC, id ASC) AS number
                FROM consultations
                WHERE patientId = ?
            )
            WHERE id = ?
        `,
            [patientId, id]
        );
        return row?.number ?? null;
    },
};
