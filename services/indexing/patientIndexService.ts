import { Directory } from "expo-file-system";

import { INDEX_META } from "../../constants/indexing";
import { STORAGE } from "../../constants/storage";
import type { Patient } from "../../types/models";
import { dermaDb, type PatientCursor, type PatientSortField, type SortDirection } from "../db/dermaDb";
import { listEntriesSafe, readJsonFromDir } from "../storage/fsUtils";
import { getDatasetRootDirectoryAsync, getPatientsRootDirectoryAsync } from "../storage/roots";

// Simple single-flight locks to prevent concurrent rebuilds/ensures.
// This avoids duplicate work when multiple screens trigger index initialization.
let ensurePatientsIndexPromise: Promise<void> | null = null;
let rebuildAllPatientsPromise: Promise<void> | null = null;

export const patientIndexService = {
    ensurePatientsIndexAsync: async () => {
        if (ensurePatientsIndexPromise) return ensurePatientsIndexPromise;

        ensurePatientsIndexPromise = (async () => {
            await dermaDb.ensureReadyAsync();

            const root = await getDatasetRootDirectoryAsync();
            const existingRootUri = await dermaDb.getMetaAsync(INDEX_META.datasetRootUri);

            if (existingRootUri !== root.uri) {
                await patientIndexService.rebuildAllPatientsAsync();
                return;
            }

            const lastReindex = await dermaDb.getMetaAsync(INDEX_META.patientsLastReindexAt);
            if (!lastReindex) {
                await patientIndexService.rebuildAllPatientsAsync();
            }
        })();

        try {
            await ensurePatientsIndexPromise;
        } finally {
            ensurePatientsIndexPromise = null;
        }
    },

    rebuildAllPatientsAsync: async () => {
        if (rebuildAllPatientsPromise) return rebuildAllPatientsPromise;

        rebuildAllPatientsPromise = (async () => {
            const root = await getDatasetRootDirectoryAsync();
            const patientsRoot = await getPatientsRootDirectoryAsync();

            // Full rebuild: clear all index data.
            await dermaDb.clearAllAsync();

            // Meta
            await dermaDb.setMetaAsync(INDEX_META.datasetRootUri, root.uri);
            await dermaDb.setMetaAsync(INDEX_META.patientsLastReindexAt, new Date().toISOString());

            // Index patients by reading patient.json in each folder.
            const entries = listEntriesSafe(patientsRoot).filter((e) => e instanceof Directory) as Directory[];

            for (const dir of entries) {
                const patient = await readJsonFromDir<Patient>(dir, STORAGE.patientFileName);
                if (!patient) continue;
                await dermaDb.upsertPatientAsync(patient);
            }

            // Any per-patient consultation meta keys are now invalid.
            await dermaDb.deleteMetaByPrefixAsync("consultations.patient.");
        })();

        try {
            await rebuildAllPatientsPromise;
        } finally {
            rebuildAllPatientsPromise = null;
        }
    },

    upsertPatientAsync: async (patient: Patient) => {
        await patientIndexService.ensurePatientsIndexAsync();
        await dermaDb.upsertPatientAsync(patient);
    },

    deletePatientAsync: async (patientId: string) => {
        await patientIndexService.ensurePatientsIndexAsync();
        await dermaDb.deletePatientAsync(patientId);
        await dermaDb.deleteMetaByPrefixAsync(`consultations.patient.${patientId}.`);
    },

    queryPatientsPageAsync: async (input: {
        limit: number;
        search?: string;
        sortField: PatientSortField;
        sortDirection: SortDirection;
        cursor?: PatientCursor;
    }) => {
        await patientIndexService.ensurePatientsIndexAsync();
        return dermaDb.queryPatientsPageAsync(input);
    },
};
