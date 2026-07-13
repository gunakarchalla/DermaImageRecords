// A consultation is identified by its consultation ID (CID): a short, user-visible
// identifier that is also the consultation's folder name inside `<patient>/consultations/`.
// CIDs are unique per patient (compared case-insensitively) and validated by the shared
// folder-name rules (services/storage/folderNames.ts). The Generate button produces the
// next free sequential number; manual entry may be any valid folder name.
//
// The per-patient visit number shown in the UI ("Visit 3 of 7") remains a *derived*
// ordinal over `createdAt`, computed by the index query — it is never stored on disk.
export const CONSULTATION = {
    maxLength: 32,

    /** Generated CIDs are zero-padded to this length: 001…999, then 1000 onwards. */
    generatedPadLength: 3,

    /**
     * The CID is the `consultationId` route segment, so it must not shadow the static
     * sibling routes under `app/patient/[patientId]/consultation/`.
     */
    reservedNames: ["add", "camera"] as readonly string[],
} as const;
