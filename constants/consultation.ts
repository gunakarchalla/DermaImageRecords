// A consultation is identified by a stable, `createdAt`-derived timestamp that is also its folder
// name (see services/consultation/consultationNumber.ts). The per-patient visit number shown in
// the UI is a *derived* ordinal over `createdAt`, computed by the index query — it is never stored
// on disk. See types/models.ts for the invariant tying `Consultation.id` to its `createdAt`.
export const CONSULTATION = {
    /**
     * Folder-name shape for a consultation: `YYYYMMDD-HHMMSS-mmm` in UTC. Sortable lexically
     * (which is chronological), filesystem-safe, and stable across devices because it is derived
     * from the immutable `createdAt`.
     */
    stampPattern: /^\d{8}-\d{6}-\d{3}$/,
} as const;
