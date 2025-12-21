export type Gender = "male" | "female" | "other" | "unspecified";

export type Patient = {
    id: string;
    name: string;
    emrNumber?: string;
    age?: number;
    gender?: Gender;
    phone?: string;
    profilePhotoUri?: string;
    profilePhotoAssetId?: string | null;
    createdAt: string;
    updatedAt: string;
};

export type Consultation = {
    id: string;
    patientId: string;
    remarks: string;
    photoUris: string[];
    photoAssetIds?: (string | null)[];
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
