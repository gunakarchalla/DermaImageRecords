// Rules for the EMR number, which *is* the patient's identity: it names the patient's
// folder on disk, is the `patientId` route param, and is the primary key of the SQLite
// index. See services/patient/emr.ts for the helpers that enforce these rules.
//
// Because the EMR becomes a directory name, the charset is deliberately narrow — no
// separators, no dots, no spaces, nothing a document provider could reinterpret.
export const EMR = {
    /** Letters and digits only. Anything else could be unsafe as a folder name. */
    pattern: /^[A-Za-z0-9]+$/,

    maxLength: 24,

    /**
     * When shown to a clinician, an EMR is broken into groups of this many characters so a long
     * identifier can be read off against a chart. Presentation only — the spaces never reach the
     * canonical value, and therefore never reach a folder name, route param, or index key.
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
     * under `app/patient/`. Compared against the canonical (uppercased) value.
     */
    reservedNames: ["ADD"] as readonly string[],
} as const;
