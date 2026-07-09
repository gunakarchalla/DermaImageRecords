import { Directory } from "expo-file-system";

import { CONSULTATION } from "../../constants/consultation";
import { listEntriesSafe } from "../storage/fsUtils";

/**
 * Consultations are numbered 1, 2, 3… within each patient, and the (zero-padded) number is the
 * consultation's folder name — so, exactly as with the patient's EMR, the filesystem carries
 * the identity.
 *
 * Numbers are **never reused**. The highest number ever issued is persisted as
 * `Patient.lastConsultationNumber`, so deleting the newest visit leaves a permanent gap rather
 * than handing its number to a different visit later. Allocation takes the maximum of that
 * counter and what is actually on disk, which keeps the sequence sound even if the counter is
 * lost or an archive is restored over the patient.
 */

/** The folder name (and `Consultation.id`) for a given sequence number. */
export const formatConsultationNumber = (value: number): string =>
    String(value).padStart(CONSULTATION.numberPadding, "0");

/** The sequence number a folder name encodes, or `null` if it isn't a consultation folder. */
export const parseConsultationNumber = (folderName: string): number | null => {
    if (!CONSULTATION.folderNamePattern.test(folderName)) return null;
    const value = Number.parseInt(folderName, 10);
    return Number.isSafeInteger(value) && value > 0 ? value : null;
};

/** `value` when it is a usable sequence number, else 0. Guards data read back from JSON. */
export const coerceConsultationNumber = (value: unknown): number =>
    typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : 0;

/**
 * The highest number any consultation folder currently claims. Folders that aren't named by a
 * number are ignored — they can't be consultations.
 */
export const highestConsultationNumberOnDisk = (consultationsDir: Directory | null): number => {
    if (!consultationsDir) return 0;

    let highest = 0;
    for (const entry of listEntriesSafe(consultationsDir)) {
        if (!(entry instanceof Directory)) continue;
        const value = parseConsultationNumber(entry.name);
        if (value !== null && value > highest) highest = value;
    }
    return highest;
};
