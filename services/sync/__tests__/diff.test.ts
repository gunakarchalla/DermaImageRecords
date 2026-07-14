import { diffTrees, type DiffLocalNode, type DiffRemoteNode, type DiffStateRow, type SyncAction } from "../diff";

const local = (entries: Record<string, Partial<DiffLocalNode>>) =>
    new Map(
        Object.entries(entries).map(([k, v]) => [
            k,
            { isDir: false, jsonFingerprint: null, ...v } as DiffLocalNode,
        ]),
    );

const remote = (entries: Record<string, Partial<DiffRemoteNode>>) =>
    new Map(
        Object.entries(entries).map(([k, v]) => [
            k,
            { id: `id-${k}`, isDir: false, md5: null, ...v } as DiffRemoteNode,
        ]),
    );

const state = (entries: Record<string, Partial<DiffStateRow>>) =>
    new Map(
        Object.entries(entries).map(([k, v]) => [
            k,
            {
                driveFileId: `id-${k}`,
                remoteMd5: null,
                localFingerprint: null,
                isDir: false,
                ...v,
            } as DiffStateRow,
        ]),
    );

const kindsFor = (actions: SyncAction[], relPath: string) =>
    actions.filter((a) => a.relPath === relPath).map((a) => a.kind);

const PHOTO = "patients/A/consultations/001/A-001-01.jpg";
const JSON_PATH = "patients/A/patient.json";

describe("diffTrees — the six relPath cases", () => {
    it("local only, no state → upload", () => {
        const actions = diffTrees(local({ [PHOTO]: {} }), remote({}), state({}));
        expect(kindsFor(actions, PHOTO)).toEqual(["upload"]);
    });

    it("remote only, no state → download", () => {
        const actions = diffTrees(local({}), remote({ [PHOTO]: {} }), state({}));
        expect(kindsFor(actions, PHOTO)).toEqual(["download"]);
    });

    it("local only WITH state → remote tampering, heal by re-upload", () => {
        const actions = diffTrees(local({ [PHOTO]: {} }), remote({}), state({ [PHOTO]: {} }));
        expect(kindsFor(actions, PHOTO)).toEqual(["reuploadMissing"]);
    });

    it("remote only WITH state → local tampering, heal by re-download", () => {
        const actions = diffTrees(local({}), remote({ [PHOTO]: {} }), state({ [PHOTO]: {} }));
        expect(kindsFor(actions, PHOTO)).toEqual(["redownloadMissing"]);
    });

    it("state only → drop the stale row", () => {
        const actions = diffTrees(local({}), remote({}), state({ [PHOTO]: {} }));
        expect(kindsFor(actions, PHOTO)).toEqual(["dropState"]);
    });

    it("both sides, photo, no state → adopt state without transferring", () => {
        const actions = diffTrees(local({ [PHOTO]: {} }), remote({ [PHOTO]: {} }), state({}));
        expect(kindsFor(actions, PHOTO)).toEqual(["adoptState"]);
    });
});

describe("diffTrees — JSON fingerprint routing", () => {
    it("in sync → no action", () => {
        const actions = diffTrees(
            local({ [JSON_PATH]: { jsonFingerprint: "aaa" } }),
            remote({ [JSON_PATH]: { md5: "bbb" } }),
            state({ [JSON_PATH]: { localFingerprint: "aaa", remoteMd5: "bbb" } }),
        );
        expect(kindsFor(actions, JSON_PATH)).toEqual([]);
    });

    it("only local changed → uploadJsonChanged", () => {
        const actions = diffTrees(
            local({ [JSON_PATH]: { jsonFingerprint: "NEW" } }),
            remote({ [JSON_PATH]: { md5: "bbb" } }),
            state({ [JSON_PATH]: { localFingerprint: "aaa", remoteMd5: "bbb" } }),
        );
        expect(kindsFor(actions, JSON_PATH)).toEqual(["uploadJsonChanged"]);
    });

    it("only remote changed → downloadJsonChanged", () => {
        const actions = diffTrees(
            local({ [JSON_PATH]: { jsonFingerprint: "aaa" } }),
            remote({ [JSON_PATH]: { md5: "NEW" } }),
            state({ [JSON_PATH]: { localFingerprint: "aaa", remoteMd5: "bbb" } }),
        );
        expect(kindsFor(actions, JSON_PATH)).toEqual(["downloadJsonChanged"]);
    });

    it("both changed → reconcileJson", () => {
        const actions = diffTrees(
            local({ [JSON_PATH]: { jsonFingerprint: "NEW-L" } }),
            remote({ [JSON_PATH]: { md5: "NEW-R" } }),
            state({ [JSON_PATH]: { localFingerprint: "aaa", remoteMd5: "bbb" } }),
        );
        expect(kindsFor(actions, JSON_PATH)).toEqual(["reconcileJson"]);
    });

    it("both present, no state (first pairing) → reconcileJson", () => {
        const actions = diffTrees(
            local({ [JSON_PATH]: { jsonFingerprint: "x" } }),
            remote({ [JSON_PATH]: { md5: "y" } }),
            state({}),
        );
        expect(kindsFor(actions, JSON_PATH)).toEqual(["reconcileJson"]);
    });

    it("same content under a new remote file id → adoptState only", () => {
        const actions = diffTrees(
            local({ [JSON_PATH]: { jsonFingerprint: "aaa" } }),
            remote({ [JSON_PATH]: { id: "fresh-id", md5: "bbb" } }),
            state({ [JSON_PATH]: { localFingerprint: "aaa", remoteMd5: "bbb", driveFileId: "old-id" } }),
        );
        expect(kindsFor(actions, JSON_PATH)).toEqual(["adoptState"]);
    });
});

describe("diffTrees — folders", () => {
    it("local folder missing remotely → createRemoteDir", () => {
        const actions = diffTrees(
            local({ "patients/A": { isDir: true } }),
            remote({}),
            state({}),
        );
        expect(kindsFor(actions, "patients/A")).toEqual(["createRemoteDir"]);
    });

    it("folder gone on both sides → dropState", () => {
        const actions = diffTrees(
            local({}),
            remote({}),
            state({ "patients/A": { isDir: true } }),
        );
        expect(kindsFor(actions, "patients/A")).toEqual(["dropState"]);
    });
});
