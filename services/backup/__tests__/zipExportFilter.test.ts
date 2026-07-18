// zipExport transitively imports the SAF storage driver (module-scope Paths.document)
// and the native Google Sign-In client; only the pure filter predicate is under test.
jest.mock("../../storage/roots", () => ({
    getDatasetRootDirectoryAsync: jest.fn(),
    initStorageAsync: jest.fn(),
}));
jest.mock("../../sync/driveClient", () => ({
    getCurrentAccountEmail: jest.fn(() => null),
}));

import { passesFilter } from "../zipExport";

const PATIENT_A_JSON = "patients/A/patient.json";
const PATIENT_A_PROFILE = "patients/A/profile-1a2b.jpg";
const PATIENT_A_THUMB = "patients/A/thumbs/profile-1a2b.jpg";
const A_C1_JSON = "patients/A/consultations/001/consultation.json";
const A_C1_PHOTO = "patients/A/consultations/001/A-001-01.jpg";
const A_C2_PHOTO = "patients/A/consultations/002/A-002-01.jpg";
const PATIENT_B_JSON = "patients/B/patient.json";
const CLINIC = "clinic.json";

describe("passesFilter", () => {
    it("no filter → everything passes", () => {
        for (const p of [PATIENT_A_JSON, A_C1_PHOTO, PATIENT_B_JSON, CLINIC]) {
            expect(passesFilter(p)).toBe(true);
        }
    });

    it("patient filter keeps selected patients and root files, drops the rest", () => {
        const filter = { patientIds: new Set(["A"]) };
        expect(passesFilter(PATIENT_A_JSON, filter)).toBe(true);
        expect(passesFilter(A_C1_PHOTO, filter)).toBe(true);
        expect(passesFilter(CLINIC, filter)).toBe(true);
        expect(passesFilter(PATIENT_B_JSON, filter)).toBe(false);
    });

    it("consultation filter keeps chosen visits plus the patient's own files", () => {
        const filter = { consultations: { patientId: "A", cids: new Set(["001"]) } };
        expect(passesFilter(A_C1_JSON, filter)).toBe(true);
        expect(passesFilter(A_C1_PHOTO, filter)).toBe(true);
        expect(passesFilter(A_C2_PHOTO, filter)).toBe(false);
        expect(passesFilter(PATIENT_A_JSON, filter)).toBe(true);
        expect(passesFilter(PATIENT_A_PROFILE, filter)).toBe(true);
        expect(passesFilter(PATIENT_A_THUMB, filter)).toBe(true);
        expect(passesFilter(PATIENT_B_JSON, filter)).toBe(false);
        expect(passesFilter(CLINIC, filter)).toBe(true);
    });
});
