import { Directory } from "expo-file-system";

import { INDEX_META } from "../../constants/indexing";
import { STORAGE } from "../../constants/storage";
import type { Patient } from "../../types/models";
import { dermaDb, type PatientCursor, type PatientSortField, type SortDirection } from "../db/dermaDb";
import { listEntriesSafe, readJsonFromDir } from "../storage/fsUtils";
import { getDatasetRootDirectoryAsync, getExistingPatientDir, getPatientsRootDirectoryAsync } from "../storage/roots";

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

    pruneMissingPatientsAsync: async (patientIds: string[]) => {
        // The filesystem is the source-of-truth; SQLite is a rebuildable index.
        // If a patient folder was deleted externally, remove the stale DB rows so the patient
        // disappears from the UI and related actions (open/delete) behave consistently.
        await patientIndexService.ensurePatientsIndexAsync();

        const missingIds = patientIds.filter((id) => !getExistingPatientDir(id));
        if (missingIds.length === 0) return;

        // Every row "missing" at once smells like a transient SAF provider failure, not a
        // real deletion — folder checks return null on listing errors too. Only prune en
        // masse when the patients root itself is reachable, so a hiccup can't wipe valid
        // index rows (and their reindex stamps) for data that is still on disk.
        if (missingIds.length === patientIds.length) {
            const patientsRoot = await getPatientsRootDirectoryAsync();
            if (!patientsRoot.exists) return;
        }

        for (const id of missingIds) {
            await dermaDb.deletePatientAsync(id);
            await dermaDb.deleteMetaByPrefixAsync(`consultations.patient.${id}.`);
        }
    },

    queryPatientsPageAsync: async (input: {
        limit: number;
        search?: string;
        sortField: PatientSortField;
        sortDirection: SortDirection;
        cursor?: PatientCursor;
    }) => {
        await patientIndexService.ensurePatientsIndexAsync();

        // Fetch from index, then reconcile with filesystem.
        // If any are missing on disk, delete them from the index and retry once.
        const first = await dermaDb.queryPatientsPageAsync(input);
        const missingIds = first.items.map((p) => p.id).filter((id) => !getExistingPatientDir(id));
        if (missingIds.length === 0) return first;

        await patientIndexService.pruneMissingPatientsAsync(missingIds);
        return dermaDb.queryPatientsPageAsync(input);
    },
};
