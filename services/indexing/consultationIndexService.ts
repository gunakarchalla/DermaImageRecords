import { Directory } from "expo-file-system";

import { consultationsPatientLastReindexAtKey } from "../../constants/indexing";
import { STORAGE } from "../../constants/storage";
import type { Consultation, ConsultationIndexRow } from "../../types/models";
import { dermaDb, type ConsultationCursor } from "../db/dermaDb";
import { listEntriesSafe, readJsonFromDir } from "../storage/fsUtils";
import { getExistingConsultationsRootDirForPatientAsync } from "../storage/roots";
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
                    const consultation = await readJsonFromDir<Consultation>(dir, STORAGE.consultationFileName);
                    if (!consultation) continue;
                    await dermaDb.upsertConsultationAsync(consultation);
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

    queryConsultationsPageAsync: async (input: {
        patientId: string;
        limit: number;
        cursor?: ConsultationCursor;
    }): Promise<{ items: ConsultationIndexRow[]; nextCursor?: ConsultationCursor }> => {
        await consultationIndexService.ensureConsultationsIndexForPatientAsync(input.patientId);
        return dermaDb.queryConsultationsPageAsync(input);
    },
};
