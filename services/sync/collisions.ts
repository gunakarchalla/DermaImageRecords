/**
 * Pure collision/conflict rules. Both devices run these independently over the same
 * data, so every rule must be deterministic and symmetric — that is what makes the
 * mirror converge without any coordination.
 */

export type LwwResolution = "keepLocal" | "takeRemote";

/**
 * Whole-record newest-wins for two copies of the SAME record (same uid). Ties (equal
 * timestamps but different bytes — pathological) break on the serialized content, so
 * both devices pick the same winner.
 */
export const resolveLww = (
    localUpdatedAt: string | undefined,
    remoteUpdatedAt: string | undefined,
    localContent: string,
    remoteContent: string,
): LwwResolution => {
    const localMs = Date.parse(localUpdatedAt ?? "") || 0;
    const remoteMs = Date.parse(remoteUpdatedAt ?? "") || 0;
    if (localMs > remoteMs) return "keepLocal";
    if (remoteMs > localMs) return "takeRemote";
    if (localContent === remoteContent) return "keepLocal"; // identical — nothing to do
    return localContent > remoteContent ? "keepLocal" : "takeRemote";
};

export type EmrCollisionPlan = "renameLocal" | "deferToRemote";

/**
 * Two DIFFERENT patients (different uids) claim the same EMR folder. Exactly one side
 * must yield; the deterministic loser is the larger uid. The loser renames its local
 * patient to a fresh EMR (and re-uploads as new); the winner just waits — the loser's
 * device applies the same rule on its own next sync.
 */
export const planEmrCollision = (localUid: string, remoteUid: string): EmrCollisionPlan =>
    localUid > remoteUid ? "renameLocal" : "deferToRemote";

export type RenumberItem = {
    /** Current folder name / CID. */
    cid: string;
    createdAt: string;
    uid: string;
};

export type RenamePlan = { from: string; to: string };

const isNumericCid = (cid: string) => /^\d+$/.test(cid);

/**
 * Full chronological renumber of a patient's NUMERIC consultation IDs: ordered by
 * `createdAt` (uid tiebreak), they are assigned 001..N. Custom (non-numeric) CIDs are
 * never rewritten. The plan is an idempotent fix-up — folders already holding their
 * correct number produce no rename — so in practice only the tail after a merge's
 * insertion point moves. Deterministic inputs ⇒ identical plans on every device.
 */
export const planChronologicalRenumber = (
    items: readonly RenumberItem[],
    padLength = 3,
): RenamePlan[] => {
    const numeric = items
        .filter((item) => isNumericCid(item.cid))
        .sort((a, b) => {
            const at = Date.parse(a.createdAt) || 0;
            const bt = Date.parse(b.createdAt) || 0;
            if (at !== bt) return at - bt;
            return a.uid < b.uid ? -1 : a.uid > b.uid ? 1 : 0;
        });

    const plans: RenamePlan[] = [];
    numeric.forEach((item, index) => {
        const to = String(index + 1).padStart(padLength, "0");
        if (item.cid !== to) plans.push({ from: item.cid, to });
    });
    return plans;
};

/**
 * Order rename plans so no step lands on a name another step still occupies. Steps
 * whose target is also a source get a two-phase temp hop (`tmp~` prefix) — the caller
 * executes `[from → viaTemp]` for those first, then `[viaTemp|from → to]`.
 */
export const sequenceRenames = (
    plans: readonly RenamePlan[],
): { from: string; to: string; viaTemp: boolean }[] => {
    const sources = new Set(plans.map((p) => p.from));
    return plans.map((p) => ({ ...p, viaTemp: sources.has(p.to) }));
};
