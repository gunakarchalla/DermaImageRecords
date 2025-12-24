export type Gender = "male" | "female" | "other" | "unspecified";

export type Patient = {
    id: string;
    name: string;
    emrNumber?: string;
    age?: number;
    gender?: Gender;
    phone?: string;
    profilePhotoUri?: string;
    createdAt: string;
    updatedAt: string;
};

export type Consultation = {
    id: string;
    patientId: string;
    remarks: string;
    photoUris: string[];
    createdAt: string;
    updatedAt: string;
};

// SQLite index-backed list row.
// NOTE: The index stores only `photoCount` (not full photo URIs) to keep the DB small and rebuildable.
export type ConsultationIndexRow = {
    id: string;
    patientId: string;
    remarks: string;
    photoCount: number;
    createdAt: string;
    updatedAt: string;
};

export type PatientInput = {
    name: string;
    emrNumber?: string;
    age?: number;
    gender?: Gender;
    phone?: string;
    profilePhotoUri?: string;
};

export type ConsultationInput = {
    remarks: string;
    photoUris: string[];
};
