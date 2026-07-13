export type Gender = "male" | "female" | "other" | "unspecified";

/**
 * Data model v2. Two kinds of fields coexist on these types:
 *
 * - **Persisted** fields are written to `patient.json` / `consultation.json`. They hold only
 *   RELATIVE file names (never absolute URIs), so the dataset is portable across devices,
 *   zip export, and the Drive mirror byte-for-byte.
 * - **Resolved** fields (suffixed `Uri`) are absolute, device-local URIs filled in by the
 *   storage layer / SQLite index at read time. `toPersistedPatient` / `toPersistedConsultation`
 *   strip them before anything is written to disk.
 *
 * Every record carries an immutable `uid` (its cross-device identity). The EMR and CID are
 * human-friendly labels that double as folder names; sync may renumber them on collision,
 * and identity survives because it lives in the uid.
 */

export type PhotoEntry = {
    /** Immutable photo identity; survives consultation renumbering. */
    uid: string;
    /** File name inside the consultation folder: `<EMR>-<CID>-<NN>.<ext>`. */
    file: string;
    /** Thumbnail path relative to the consultation folder: `thumbs/<file name>.jpg`. */
    thumb?: string;
    capturedAt: string;
};

/**
 * INVARIANT: `id === emrNumber`, always the canonical (trimmed, NFC-normalized) EMR.
 *
 * The EMR is the patient's identity: it names the patient's folder under `patients/`, it is
 * the `patientId` route param, it is the primary key of the SQLite index, and it is the
 * `patientId` stored in every consultation. `id` is the structural identifier used by
 * storage/routing, `emrNumber` the name the UI reads — two spellings of one value.
 * Uniqueness is case-insensitive (see services/storage/folderNames.ts).
 */
export type Patient = {
    schema: 2;
    uid: string;
    id: string;
    emrNumber: string;
    name: string;
    age?: number;
    gender?: Gender;
    phone?: string;
    /** Persisted: relative file name, e.g. `profile-1a2b3c4d.jpg`. */
    profilePhoto?: string;
    /** Persisted: relative path, e.g. `thumbs/profile-1a2b3c4d.jpg`. */
    profileThumb?: string;
    createdAt: string;
    updatedAt: string;

    /** Resolved (never persisted): absolute URI of `profilePhoto` on this device. */
    profilePhotoUri?: string;
    /** Resolved (never persisted): absolute URI of `profileThumb` on this device. */
    profileThumbUri?: string;
};

/**
 * INVARIANT: `id === cid`, the consultation's folder name inside `<patient>/consultations/`.
 *
 * There is no stored visit number: the 1, 2, 3… a clinician sees is a derived ordinal over
 * `createdAt`, produced by the index query (see ConsultationIndexRow.number). Generated CIDs
 * are sequential so they usually match that ordinal, but a manual CID may be any name.
 */
export type Consultation = {
    schema: 2;
    uid: string;
    id: string;
    /** Same value as `id`; the name the UI reads. */
    cid: string;
    patientId: string;
    /** Belt-and-braces linkage for sync merges; the EMR remains the path key. */
    patientUid: string;
    remarks: string;
    /** Persisted photo records, in display order. */
    photos: PhotoEntry[];
    /** Monotonic counter for `<NN>` in photo file names. Never decremented or reused. */
    nextPhotoNumber: number;
    createdAt: string;
    updatedAt: string;

    /** Resolved (never persisted): absolute URIs of `photos[i].file`, same order. */
    photoUris: string[];
    /** Resolved (never persisted): absolute URIs of `photos[i].thumb` (null if missing). */
    thumbUris: (string | null)[];
};

/** The exact shapes written to disk: the resolved URI fields stripped. */
export type PersistedPatient = Omit<Patient, "profilePhotoUri" | "profileThumbUri">;
export type PersistedConsultation = Omit<Consultation, "photoUris" | "thumbUris">;

export const toPersistedPatient = (patient: Patient): PersistedPatient => {
    const { profilePhotoUri, profileThumbUri, ...persisted } = patient;
    return persisted;
};

export const toPersistedConsultation = (consultation: Consultation): PersistedConsultation => {
    const { photoUris, thumbUris, ...persisted } = consultation;
    return persisted;
};

// SQLite index-backed list row.
// NOTE: The index stores only `photoCount` (not photo records) to keep rows small; the
// gallery has its own `photos` table. `number` is the derived display ordinal (position
// over `createdAt`), computed by the query — it is not a stored column.
export type ConsultationIndexRow = {
    id: string;
    number: number;
    patientId: string;
    remarks: string;
    photoCount: number;
    createdAt: string;
    updatedAt: string;
};

/** SQLite `photos` row powering the gallery feed. URIs are resolved, device-local. */
export type PhotoIndexRow = {
    patientId: string;
    consultationId: string;
    uid: string;
    file: string;
    /** Position within the consultation's photo order (the viewer's `index` param). */
    position: number;
    uri: string;
    thumbUri: string | null;
    capturedAt: string;
};

/** Creating a patient is the only moment an EMR number may be chosen, so it is required here. */
export type PatientCreateInput = {
    emrNumber: string;
    name: string;
    age?: number;
    gender?: Gender;
    phone?: string;
    profilePhotoUri?: string;
};

/**
 * Editing a patient cannot change the EMR — the field is absent by design, so an attempt to
 * reassign identity fails to compile rather than silently orphaning a folder.
 */
export type PatientUpdateInput = {
    name: string;
    age?: number;
    gender?: Gender;
    phone?: string;
    profilePhotoUri?: string;
};

export type ConsultationInput = {
    remarks: string;
    /**
     * Ordered photo list: resolved URIs of photos already in the consultation (kept), mixed
     * with source URIs of new captures/picks (encoded + numbered at save). Anything the
     * consultation had that is absent here is deleted.
     */
    photoUris: string[];
    /** Only honored when creating; a consultation's CID is immutable afterwards. */
    cid?: string;
};
