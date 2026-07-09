// A consultation is identified by a per-patient sequence number starting at 1, which is also
// its folder name. See services/consultation/consultationNumber.ts for the helpers, and
// types/models.ts for the invariant tying `Consultation.id` to `Consultation.number`.
export const CONSULTATION = {
    /**
     * Folder names are zero-padded so a file manager lists visits in visit order (0001, 0002,
     * …, 0010) rather than lexically (1, 10, 2). Numbers past 9999 simply grow wider; ordering
     * inside the app never depends on the padding, only on the integer stored in the index.
     */
    numberPadding: 4,

    /** A consultation folder is named by its number and nothing else. */
    folderNamePattern: /^\d+$/,
} as const;
