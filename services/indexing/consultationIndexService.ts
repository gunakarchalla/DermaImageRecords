import { Directory } from "expo-file-system";

import { consultationsPatientLastReindexAtKey } from "../../constants/indexing";
import { STORAGE } from "../../constants/storage";
import type { Consultation, ConsultationIndexRow } from "../../types/models";
import { parseConsultationNumber } from "../consultation/consultationNumber";
import { dermaDb, type ConsultationCursor } from "../db/dermaDb";
import { listEntriesSafe, readJsonFromDir } from "../storage/fsUtils";
import { getExistingConsultationDir, getExistingConsultationsRootDirForPatientAsync } from "../storage/roots";
import { patientIndexService } from "./patientIndexService";

// Prevent concurrent rebuilds for the same patientId (e.g., rapid navigation/focus events).
const rebuildConsultationsPromiseByPatient = new Map<string, Promise<void>>();

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
                const entries = listEntriesSafe(consultationsRoot).filter((e) => e instanceof Directory) as Directory[];
                for (const dir of entries) {
                    // The folder name *is* the consultation number, so it wins over anything the
                    // JSON claims. A folder not named by a number cannot be a consultation.
                    const number = parseConsultationNumber(dir.name);
                    if (number === null) continue;

                    const consultation = await readJsonFromDir<Consultation>(dir, STORAGE.consultationFileName);
                    if (!consultation) continue;

                    await dermaDb.upsertConsultationAsync({ ...consultation, id: dir.name, number, patientId });
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

    upsertConsultationAsync: async (consultation: Consultation) => {
        await consultationIndexService.ensureConsultationsIndexForPatientAsync(consultation.patientId);
        await dermaDb.upsertConsultationAsync(consultation);
    },

    deleteConsultationAsync: async (patientId: string, consultationId: string) => {
        await consultationIndexService.ensureConsultationsIndexForPatientAsync(patientId);
        await dermaDb.deleteConsultationAsync(patientId, consultationId);
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
