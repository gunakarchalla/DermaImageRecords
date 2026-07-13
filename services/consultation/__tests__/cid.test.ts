// cid.ts transitively imports the SAF storage driver; only pure helpers run under jest.
jest.mock("../../storage/roots", () => ({
    getExistingConsultationsRootDirForPatientAsync: jest.fn(),
}));
jest.mock("../../storage/fsUtils", () => ({
    listEntriesSafe: jest.fn(() => []),
}));

import { nextSequentialCid, validateCid } from "../cid";

describe("nextSequentialCid", () => {
    it("starts at 001 for a patient with no consultations", () => {
        expect(nextSequentialCid([])).toBe("001");
    });

    it("returns one past the highest numeric CID", () => {
        expect(nextSequentialCid(["001", "002", "003"])).toBe("004");
    });

    it("ignores non-numeric CIDs when sequencing", () => {
        expect(nextSequentialCid(["001", "BIOPSY1", "007"])).toBe("008");
        expect(nextSequentialCid(["BIOPSY1"])).toBe("001");
    });

    it("fills no gaps — deleted numbers are never reused", () => {
        expect(nextSequentialCid(["001", "005"])).toBe("006");
    });

    it("grows naturally past 999", () => {
        expect(nextSequentialCid(["999"])).toBe("1000");
        expect(nextSequentialCid(["1000"])).toBe("1001");
    });

    it("handles unpadded numeric names", () => {
        expect(nextSequentialCid(["7"])).toBe("008");
    });
});

describe("validateCid", () => {
    it("accepts generated and custom names", () => {
        for (const good of ["001", "1000", "BIOPSY1", "follow up 2"]) {
            expect(validateCid(good)).toBeNull();
        }
    });

    it("rejects the route-reserved names add and camera, case-insensitively", () => {
        for (const bad of ["add", "ADD", "camera", "Camera"]) {
            expect(validateCid(bad)).toMatch(/reserved/i);
        }
    });

    it("rejects folder-unsafe characters", () => {
        expect(validateCid("a/b")).toMatch(/can't contain/i);
        expect(validateCid("a~b")).toMatch(/can't contain/i);
    });
});
