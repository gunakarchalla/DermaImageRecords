export type Gender = "male" | "female" | "other" | "unspecified";

/**
 * INVARIANT: `id === emrNumber`, always the canonical (trimmed, uppercased) EMR.
 *
 * The EMR number is the patient's identity: it names the patient's folder under `patients/`,
 * it is the `patientId` route param, it is the primary key of the SQLite index, and it is the
 * `patientId` stored in every consultation. `id` is kept as the structural identifier used by
 * storage/routing, `emrNumber` as the name the UI reads — they are two spellings of one value.
 *
 * Only two writers construct a Patient (`createPatientAsync` and the importer); both derive
 * these fields together from a single canonical string. The EMR is immutable thereafter.
 */
export type Patient = {
    id: string;
    emrNumber: string;
    name: string;
    age?: number;
    gender?: Gender;
    phone?: string;
    profilePhotoUri?: string;
    createdAt: string;
    updatedAt: string;
};

/**
 * INVARIANT: `id === folderStampFromCreatedAt(createdAt)`, and `id` is the consultation's folder
 * name inside `<patient>/consultations/`. The id is a stable, timezone-independent timestamp
 * derived from the immutable `createdAt` — it is the cross-device identity that makes merging a
 * folder union (see services/consultation/consultationNumber.ts).
 *
 * There is no stored visit number: the 1, 2, 3… a clinician sees is a derived ordinal over
 * `createdAt`, produced by the index query (see ConsultationIndexRow.number).
 */
export type Consultation = {
    id: string;
    patientId: string;
    remarks: string;
    photoUris: string[];
    createdAt: string;
    updatedAt: string;
};

// SQLite index-backed list row.
// NOTE: The index stores only `photoCount` (not full photo URIs) to keep the DB small and
// rebuildable. `number` is the derived display ordinal (position over `createdAt`), computed by
// the query — it is not a stored column.
export type ConsultationIndexRow = {
    id: string;
    number: number;
    patientId: string;
    remarks: string;
    photoCount: number;
    createdAt: string;
    updatedAt: string;
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
    photoUris: string[];
};
