import {
    planChronologicalRenumber,
    planEmrCollision,
    resolveLww,
    sequenceRenames,
} from "../collisions";

describe("resolveLww", () => {
    it("newer local wins", () => {
        expect(resolveLww("2026-01-02", "2026-01-01", "a", "b")).toBe("keepLocal");
    });

    it("newer remote wins", () => {
        expect(resolveLww("2026-01-01", "2026-01-02", "a", "b")).toBe("takeRemote");
    });

    it("identical content on a tie is a no-op keepLocal", () => {
        expect(resolveLww("2026-01-01", "2026-01-01", "same", "same")).toBe("keepLocal");
    });

    it("content tie-break is symmetric: both devices pick the same winner", () => {
        const onDeviceA = resolveLww("2026-01-01", "2026-01-01", "aaa", "zzz");
        const onDeviceB = resolveLww("2026-01-01", "2026-01-01", "zzz", "aaa");
        // A keeps remote ("zzz"), B keeps local ("zzz") — same surviving content.
        expect(onDeviceA).toBe("takeRemote");
        expect(onDeviceB).toBe("keepLocal");
    });
});

describe("planEmrCollision", () => {
    it("the larger uid renames; the smaller waits — never both, never neither", () => {
        expect(planEmrCollision("bbb", "aaa")).toBe("renameLocal");
        expect(planEmrCollision("aaa", "bbb")).toBe("deferToRemote");
    });
});

describe("planChronologicalRenumber", () => {
    it("assigns 001..N by createdAt and skips already-correct folders", () => {
        const plans = planChronologicalRenumber([
            { cid: "001", createdAt: "2026-01-01", uid: "u1" },
            { cid: "003", createdAt: "2026-01-02", uid: "u3" },
        ]);
        expect(plans).toEqual([{ from: "003", to: "002" }]);
    });

    it("is a no-op when numbering already matches chronology", () => {
        const plans = planChronologicalRenumber([
            { cid: "001", createdAt: "2026-01-01", uid: "u1" },
            { cid: "002", createdAt: "2026-01-02", uid: "u2" },
        ]);
        expect(plans).toEqual([]);
    });

    it("never touches custom, non-numeric CIDs", () => {
        const plans = planChronologicalRenumber([
            { cid: "BIOPSY1", createdAt: "2026-01-01", uid: "u1" },
            { cid: "001", createdAt: "2026-01-02", uid: "u2" },
        ]);
        expect(plans).toEqual([]);
    });

    it("uses uid as the deterministic tiebreak for equal createdAt", () => {
        const forward = planChronologicalRenumber([
            { cid: "007", createdAt: "2026-01-01", uid: "b" },
            { cid: "008", createdAt: "2026-01-01", uid: "a" },
        ]);
        const reversedInput = planChronologicalRenumber([
            { cid: "008", createdAt: "2026-01-01", uid: "a" },
            { cid: "007", createdAt: "2026-01-01", uid: "b" },
        ]);
        // Same plan regardless of input order — devices converge.
        expect(forward).toEqual(reversedInput);
        expect(forward).toEqual([
            { from: "008", to: "001" },
            { from: "007", to: "002" },
        ]);
    });

    it("insertion in the middle shifts only the tail", () => {
        const plans = planChronologicalRenumber([
            { cid: "001", createdAt: "2026-01-01", uid: "u1" },
            { cid: "002", createdAt: "2026-01-03", uid: "u2" },
            { cid: "003", createdAt: "2026-01-04", uid: "u3" },
            // Merged in from another device, dated between 001 and 002:
            { cid: "004", createdAt: "2026-01-02", uid: "u4" },
        ]);
        // 001 keeps its number; the rest re-slot (plan order follows chronology).
        expect(plans).toHaveLength(3);
        expect(new Map(plans.map((p) => [p.from, p.to]))).toEqual(
            new Map([
                ["004", "002"],
                ["002", "003"],
                ["003", "004"],
            ]),
        );
    });
});

describe("sequenceRenames", () => {
    it("flags renames whose target is still occupied by another source", () => {
        const sequenced = sequenceRenames([
            { from: "002", to: "003" },
            { from: "003", to: "004" },
            { from: "004", to: "002" },
        ]);
        expect(sequenced.every((s) => s.viaTemp)).toBe(true);
    });

    it("leaves independent renames direct", () => {
        const sequenced = sequenceRenames([{ from: "005", to: "002" }]);
        expect(sequenced).toEqual([{ from: "005", to: "002", viaTemp: false }]);
    });
});
