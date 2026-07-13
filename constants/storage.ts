// Central names for on-disk folder/file structure.
// The filesystem remains the source-of-truth; SQLite (if used) is a rebuildable index.
export const STORAGE = {
    externalRootFolderName: "DermaImageRecords",
    patientsFolderName: "patients",
    consultationsFolderName: "consultations",

    patientFileName: "patient.json",
    consultationFileName: "consultation.json",
    // Thumbnails live beside their originals in this subfolder (no leading dot —
    // some SAF document providers mishandle dot-prefixed names).
    thumbsFolderName: "thumbs",
    // New profile photos get a content-addressed stem (`profile-<rand8>`) so a changed
    // photo changes its file name — image caches invalidate naturally, no cache busters.
    profilePhotoPrefix: "profile-",

    // Stored in app sandbox Documents (config, not data) to remember the SAF root URI.
    storageRootConfigFileName: "DermaImageRecords.storage-root.json",

    // Cache folder for render-safe copies of content:// URIs.
    imageCacheFolderName: "DermaImageRecordsImageCache",
} as const;
