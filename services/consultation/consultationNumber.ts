import { CONSULTATION } from "../../constants/consultation";

/**
 * A consultation's identity is a stable timestamp derived from its `createdAt`, which is also its
 * folder name inside `<patient>/consultations/`. This is what makes merging safe across devices:
 * the same visit seeded onto two devices carries the same `createdAt`, hence the same folder id,
 * so a merge is a plain folder union (see services/backup/backupService.ts). Two genuinely
 * different visits get different ids and both survive.
 *
 * The visit *number* a clinician sees (1, 2, 3…) is not stored — it is a derived ordinal over
 * `createdAt` produced by the index query (see services/db/dermaDb.ts). It is therefore always
 * contiguous: deleting an early visit simply re-labels the later ones, and no counter is kept.
 */

const pad = (value: number, width = 2): string => String(value).padStart(width, "0");

/**
 * The folder name (and `Consultation.id`) for a consultation created at `createdAt`. Built from
 * UTC components so the stamp is identical on every device for the same instant — that identity
 * is the whole point. Invariant: `id === folderStampFromCreatedAt(createdAt)`.
 */
export const folderStampFromCreatedAt = (createdAt: string): string => {
    const parsed = new Date(createdAt);
    const date = Number.isNaN(parsed.getTime()) ? new Date(0) : parsed;
    return (
        `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}` +
        `-${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}` +
        `-${pad(date.getUTCMilliseconds(), 3)}`
    );
};

/** Whether `name` looks like a consultation folder minted by the current scheme. */
export const isConsultationStamp = (name: string): boolean => CONSULTATION.stampPattern.test(name);
