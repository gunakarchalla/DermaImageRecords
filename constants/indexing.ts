// Centralized meta keys used for rebuildable SQLite indexes.
// Keeping these in one place avoids string duplication across services.
export const INDEX_META = {
    datasetRootUri: "dataset.rootUri",
    patientsLastReindexAt: "patients.lastReindexAt",
} as const;

export const consultationsPatientLastReindexAtKey = (patientId: string) =>
    `consultations.patient.${patientId}.lastReindexAt`;
