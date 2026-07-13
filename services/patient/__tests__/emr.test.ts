// emr.ts transitively imports the SAF storage driver, which resolves Paths.document at
// module load and cannot run under jest. Only the pure helpers are under test here.
jest.mock("../../storage/roots", () => ({
    getPatientsRootDirectoryAsync: jest.fn(),
    initStorageAsync: jest.fn(),
}));
jest.mock("../../storage/fsUtils", () => ({
    listEntriesSafe: jest.fn(() => []),
}));

import {
    canonicalizeEmrNumber,
    formatEmrNumberForDisplay,
    requireValidEmrNumber,
    validateEmrNumber,
} from "../emr";

describe("canonicalizeEmrNumber", () => {
    it("trims and preserves case", () => {
        expect(canonicalizeEmrNumber("  abC123 ")).toBe("abC123");
    });

    it("normalizes to NFC so all platforms produce identical bytes", () => {
        const nfd = "éclair"; // é as e + combining accent
        expect(canonicalizeEmrNumber(nfd)).toBe("éclair");
    });

    it("maps null/undefined to the empty string", () => {
        expect(canonicalizeEmrNumber(null)).toBe("");
        expect(canonicalizeEmrNumber(undefined)).toBe("");
    });
});

describe("validateEmrNumber", () => {
    it("accepts alphanumerics, spaces, dashes, and unicode", () => {
        for (const good of ["ABC123", "John Smith", "MRN-2024-001", "épreuve", "патиент7"]) {
            expect(validateEmrNumber(good)).toBeNull();
        }
    });

    it("rejects the empty string", () => {
        expect(validateEmrNumber("")).toMatch(/enter a/i);
    });

    it("rejects values over the maximum length", () => {
        expect(validateEmrNumber("A".repeat(33))).toMatch(/at most 32/);
        expect(validateEmrNumber("A".repeat(32))).toBeNull();
    });

    it("rejects characters invalid in folder names on any platform", () => {
        for (const bad of ["A<B", "A>B", "A:B", 'A"B', "A/B", "A\\B", "A|B", "A?B", "A*B", "A~B"]) {
            expect(validateEmrNumber(bad)).toMatch(/can't contain/i);
        }
    });

    it("rejects leading/trailing dots", () => {
        expect(validateEmrNumber(".hidden")).toMatch(/dot/i);
        expect(validateEmrNumber("name.")).toMatch(/dot/i);
    });

    it("rejects Windows reserved device names, case-insensitively", () => {
        for (const bad of ["CON", "con", "NUL", "com1", "LPT9"]) {
            expect(validateEmrNumber(bad)).toMatch(/can't be used|reserved/i);
        }
    });

    it("rejects reserved route names, case-insensitively", () => {
        expect(validateEmrNumber("ADD")).toMatch(/reserved/i);
        expect(validateEmrNumber("add")).toMatch(/reserved/i);
    });
});

describe("requireValidEmrNumber", () => {
    it("returns the canonical form of a valid raw value", () => {
        expect(requireValidEmrNumber(" abC123 ")).toBe("abC123");
    });

    it("throws on an invalid value", () => {
        expect(() => requireValidEmrNumber("no/slash")).toThrow(/can't contain/i);
    });
});

describe("formatEmrNumberForDisplay", () => {
    it("groups purely numeric EMRs in threes", () => {
        expect(formatEmrNumberForDisplay("123456789")).toBe("123 456 789");
        expect(formatEmrNumberForDisplay("1234")).toBe("123 4");
    });

    it("shows non-numeric EMRs verbatim", () => {
        expect(formatEmrNumberForDisplay("MRN-2024-001")).toBe("MRN-2024-001");
        expect(formatEmrNumberForDisplay("John Smith")).toBe("John Smith");
    });
});
