// Central names for on-disk folder/file structure.
// The filesystem remains the source-of-truth; SQLite (if used) is a rebuildable index.
export const STORAGE = {
    externalRootFolderName: "DermaImageRecords",
    patientsFolderName: "patients",
    consultationsFolderName: "consultations",

    patientFileName: "patient.json",
    consultationFileName: "consultation.json",
    profilePhotoFileName: "profile.jpg",

    // Stored in app sandbox Documents (config, not data) to remember the SAF root URI.
    storageRootConfigFileName: "DermaImageRecords.storage-root.json",

    // Cache folder for render-safe copies of content:// URIs.
    imageCacheFolderName: "DermaImageRecordsImageCache",
} as const;
