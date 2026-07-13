// Rules for the EMR number, which *is* the patient's identity: it names the patient's
// folder on disk, is the `patientId` route param, and is the primary key of the SQLite
// index. See services/patient/emr.ts for the helpers that enforce these rules, and
// services/storage/folderNames.ts for the cross-platform folder-name validation both
// the EMR and the consultation ID share.
export const EMR = {
    maxLength: 32,

    /**
     * When shown to a clinician, a purely numeric EMR is broken into groups of this many
     * characters so a long identifier can be read off against a chart. Presentation only —
     * the spaces never reach the canonical value, and non-numeric EMRs are shown verbatim.
     */
    displayGroupSize: 3,

    /**
     * A generated EMR is purely numeric (see `generateEmrNumberAsync`). Nine digits, with a
     * non-zero leading digit, gives a ~900 million space (100000000–999999999); the generator
     * still verifies the candidate is unused, so collisions are effectively impossible.
     */
    generatedDigits: 9,

    /**
     * Bounded retries when a generated candidate is already taken. Exceeding this many
     * collisions means the dataset is implausibly dense, and the user should type an EMR.
     */
    maxGenerateAttempts: 25,

    /**
     * The EMR is the `patientId` route segment, so it must not shadow a static sibling route
     * under `app/patient/`. Compared case-insensitively.
     */
    reservedNames: ["add"] as readonly string[],
} as const;
