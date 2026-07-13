// emr.ts transitively imports the SAF storage driver, which resolves Paths.document at
// module load and cannot run under jest. Only the pure helpers are under test here;
// Phase 3 moves them into services/storage/folderNames.ts and these mocks go away.
jest.mock("../../storage/roots", () => ({
    getPatientsRootDirectoryAsync: jest.fn(),
    initStorageAsync: jest.fn(),
}));
jest.mock("../../storage/fsUtils", () => ({
    listEntriesSafe: jest.fn(() => []),
}));

import {
    canonicalizeEmrNumber,
    emrDisplayMaxLength,
    formatEmrNumberForDisplay,
    requireValidEmrNumber,
    stripEmrDisplaySpacing,
    validateEmrNumber,
} from "../emr";

describe("canonicalizeEmrNumber", () => {
    it("trims and uppercases", () => {
        expect(canonicalizeEmrNumber("  abc123 ")).toBe("ABC123");
    });

    it("maps null/undefined to the empty string", () => {
        expect(canonicalizeEmrNumber(null)).toBe("");
        expect(canonicalizeEmrNumber(undefined)).toBe("");
    });
});

describe("validateEmrNumber", () => {
    it("accepts a plain alphanumeric value", () => {
        expect(validateEmrNumber("ABC123")).toBeNull();
    });

    it("rejects the empty string", () => {
        expect(validateEmrNumber("")).toMatch(/enter an emr/i);
    });

    it("rejects values over the maximum length", () => {
        expect(validateEmrNumber("A".repeat(25))).toMatch(/at most 24/);
        expect(validateEmrNumber("A".repeat(24))).toBeNull();
    });

    it("rejects non-alphanumeric characters", () => {
        for (const bad of ["AB 12", "AB-12", "AB.12", "AB/12"]) {
            expect(validateEmrNumber(bad)).toMatch(/letters and numbers/i);
        }
    });

    it("rejects reserved route names", () => {
        expect(validateEmrNumber("ADD")).toMatch(/reserved/i);
    });
});

describe("requireValidEmrNumber", () => {
    it("returns the canonical form of a valid raw value", () => {
        expect(requireValidEmrNumber(" abc123 ")).toBe("ABC123");
    });

    it("throws on an invalid value", () => {
        expect(() => requireValidEmrNumber("no/slash")).toThrow(/letters and numbers/i);
    });
});

describe("display formatting", () => {
    it("groups from the left in threes", () => {
        expect(formatEmrNumberForDisplay("123456789")).toBe("123 456 789");
        expect(formatEmrNumberForDisplay("1234")).toBe("123 4");
    });

    it("round-trips through stripEmrDisplaySpacing", () => {
        const canonical = "ABC123XYZ7";
        expect(stripEmrDisplaySpacing(formatEmrNumberForDisplay(canonical))).toBe(canonical);
    });

    it("emrDisplayMaxLength accounts for group separators", () => {
        // 24 chars in groups of 3 → 7 separating spaces.
        expect(emrDisplayMaxLength).toBe(31);
    });
});
