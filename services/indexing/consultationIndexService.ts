import { Directory } from "expo-file-system";

import { consultationsPatientLastReindexAtKey } from "../../constants/indexing";
import type { ConsultationIndexRow, PhotoIndexRow } from "../../types/models";
import { mapWithConcurrency } from "../async";
import { dermaDb, type ConsultationCursor, type PhotoCursor } from "../db/dermaDb";
import { listEntriesSafe } from "../storage/fsUtils";
import { isTempFolderName, readConsultationAsync } from "../storage/records";
import {
    getExistingConsultationDir,
    getExistingConsultationsRootDirForPatientAsync,
    getPatientsRootDirectoryAsync,
} from "../storage/roots";
import { patientIndexService } from "./patientIndexService";

// Prevent concurrent rebuilds for the same patientId (e.g., rapid navigation/focus events).
const rebuildConsultationsPromiseByPatient = new Map<string, Promise<void>>();

// Single-flight for the whole-dataset pass the gallery needs.
let ensureAllPatientsPromise: Promise<void> | null = null;

export const consultationIndexService = {
    ensureConsultationsIndexForPatientAsync: async (patientId: string) => {
        // Ensure DB is initialized and root is consistent.
        await patientIndexService.ensurePatientsIndexAsync();

        const metaKey = consultationsPatientLastReindexAtKey(patientId);
        const last = await dermaDb.getMetaAsync(metaKey);
        if (!last) {
            await consultationIndexService.rebuildConsultationsForPatientAsync(patientId);
        }
    },

    rebuildConsultationsForPatientAsync: async (patientId: string) => {
        const existing = rebuildConsultationsPromiseByPatient.get(patientId);
        if (existing) return existing;

        const promise = (async () => {
            await patientIndexService.ensurePatientsIndexAsync();

            await dermaDb.deleteConsultationsByPatientAsync(patientId);

            const consultationsRoot = await getExistingConsultationsRootDirForPatientAsync(patientId);
            if (consultationsRoot?.exists) {
                const entries = listEntriesSafe(consultationsRoot).filter(
                    (e): e is Directory => e instanceof Directory && !isTempFolderName(e.name),
                );
                for (const dir of entries) {
                    // A consultation folder is one that holds a v2 consultation.json; the folder
                    // name is the CID. The display number is derived at query time, not stored.
                    const consultation = await readConsultationAsync(dir);
                    if (!consultation) continue;

                    await dermaDb.upsertConsultationAsync({
                        ...consultation,
                        id: dir.name,
                        cid: dir.name,
                        patientId,
                    });
                }
            }

            await dermaDb.setMetaAsync(consultationsPatientLastReindexAtKey(patientId), new Date().toISOString());
        })();

        rebuildConsultationsPromiseByPatient.set(patientId, promise);
        try {
            await promise;
        } finally {
            rebuildConsultationsPromiseByPatient.delete(patientId);
        }
    },

    upsertConsultationAsync: async (consultation: Parameters<typeof dermaDb.upsertConsultationAsync>[0]) => {
        await consultationIndexService.ensureConsultationsIndexForPatientAsync(consultation.patientId);
        await dermaDb.upsertConsultationAsync(consultation);
    },

    /**
     * Make sure every patient's consultations are indexed — the gallery pages over the
     * whole `photos` table, and per-patient lazy indexing only covers patients the user
     * has opened. Rebuilds only patients missing their reindex stamp; single-flight.
     */
    ensureAllPatientsIndexedAsync: async () => {
        if (ensureAllPatientsPromise) return ensureAllPatientsPromise;

        ensureAllPatientsPromise = (async () => {
            await patientIndexService.ensurePatientsIndexAsync();

            const patientsRoot = await getPatientsRootDirectoryAsync();
            const patientIds = listEntriesSafe(patientsRoot)
                .filter((e): e is Directory => e instanceof Directory && !isTempFolderName(e.name))
                .map((dir) => dir.name);

            const missing: string[] = [];
            for (const patientId of patientIds) {
                const stamp = await dermaDb.getMetaAsync(consultationsPatientLastReindexAtKey(patientId));
                if (!stamp) missing.push(patientId);
            }

            // Concurrency covers the file reads; SQLite writes serialize internally.
            await mapWithConcurrency(missing, 4, (patientId) =>
                consultationIndexService.rebuildConsultationsForPatientAsync(patientId),
            );
        })();

        try {
            await ensureAllPatientsPromise;
        } finally {
            ensureAllPatientsPromise = null;
        }
    },

    /** Newest-first page of the global photo feed (see dermaDb.queryPhotosPageAsync). */
    queryPhotosPageAsync: async (input: {
        limit: number;
        cursor?: PhotoCursor;
    }): Promise<{ items: PhotoIndexRow[]; nextCursor?: PhotoCursor }> => {
        await consultationIndexService.ensureAllPatientsIndexedAsync();
        return dermaDb.queryPhotosPageAsync(input);
    },

    deleteConsultationAsync: async (patientId: string, consultationId: string) => {
        await consultationIndexService.ensureConsultationsIndexForPatientAsync(patientId);
        await dermaDb.deleteConsultationAsync(patientId, consultationId);
    },

    /** The derived display number (position over `createdAt`) for one consultation, or null. */
    getConsultationNumberAsync: async (
        patientId: string,
        consultationId: string,
    ): Promise<number | null> => {
        await consultationIndexService.ensureConsultationsIndexForPatientAsync(patientId);
        return dermaDb.getConsultationNumberAsync(patientId, consultationId);
    },

    deleteConsultationsByPatientAsync: async (patientId: string) => {
        await patientIndexService.ensurePatientsIndexAsync();
        await dermaDb.deleteConsultationsByPatientAsync(patientId);
        await dermaDb.deleteMetaByPrefixAsync(`consultations.patient.${patientId}.`);
    },

    pruneMissingConsultationsAsync: async (patientId: string, consultationIds: string[]) => {
        // The filesystem is the source-of-truth; SQLite is a rebuildable index.
        // If consultation folders were deleted externally, remove stale DB rows so the UI
        // does not show consultations that can no longer be opened.
        await consultationIndexService.ensureConsultationsIndexForPatientAsync(patientId);

        const missingIds = consultationIds.filter((id) => !getExistingConsultationDir(patientId, id));
        if (missingIds.length === 0) return;

        // Guard against transient SAF listing failures (folder checks return null on errors
        // too): when *everything* looks missing, only prune if the consultations root is
        // actually reachable — otherwise a provider hiccup would wipe valid index rows.
        if (missingIds.length === consultationIds.length) {
            const consultationsRoot = await getExistingConsultationsRootDirForPatientAsync(patientId);
            if (!consultationsRoot?.exists) return;
        }

        for (const id of missingIds) {
            await dermaDb.deleteConsultationAsync(patientId, id);
        }

        // Mark the per-patient consultations index as fresh after pruning.
        await dermaDb.setMetaAsync(consultationsPatientLastReindexAtKey(patientId), new Date().toISOString());
    },

    queryConsultationsPageAsync: async (input: {
        patientId: string;
        limit: number;
        cursor?: ConsultationCursor;
    }): Promise<{ items: ConsultationIndexRow[]; nextCursor?: ConsultationCursor }> => {
        await consultationIndexService.ensureConsultationsIndexForPatientAsync(input.patientId);

        // Fetch from index, then reconcile with filesystem.
        // If any are missing on disk, delete them from the index and retry once.
        const first = await dermaDb.queryConsultationsPageAsync(input);
        const missingIds = first.items.map((c) => c.id).filter((id) => !getExistingConsultationDir(input.patientId, id));
        if (missingIds.length === 0) return first;

        await consultationIndexService.pruneMissingConsultationsAsync(input.patientId, missingIds);
        return dermaDb.queryConsultationsPageAsync(input);
    },
};
