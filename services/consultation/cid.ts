import { Directory } from "expo-file-system";

import { CONSULTATION } from "../../constants/consultation";
import {
    canonicalizeFolderName,
    folderNameKey,
    validateFolderName,
} from "../storage/folderNames";
import { listEntriesSafe } from "../storage/fsUtils";
import { getExistingConsultationsRootDirForPatientAsync } from "../storage/roots";

/**
 * The consultation ID (CID) is a consultation's identity within one patient: it names the
 * consultation's folder under `<patient>/consultations/`, is the `consultationId` route
 * param, and appears in every photo filename (`<EMR>-<CID>-<NN>`). Uniqueness is scoped to
 * the patient and compared case-insensitively (same reasoning as the EMR — see
 * services/patient/emr.ts).
 *
 * Generated CIDs are sequential numbers ("001", "002", …) so the ID a clinician quotes is
 * short and roughly chronological. Manual CIDs may be any valid folder name ("BIOPSY1").
 * Cross-device collisions are resolved at sync time by renumbering — record identity is
 * the hidden `uid`, so a CID is a label, not an anchor.
 */

/** Thrown when the CID a user typed already belongs to another consultation of this patient. */
export class CidTakenError extends Error {
    constructor(public readonly cid: string) {
        super(`Consultation ID "${cid}" is already used for this patient.`);
        this.name = "CidTakenError";
    }
}

/** The one true stored form of a CID (trimmed, NFC-normalized, case preserved). */
export const canonicalizeCid = (raw: string | null | undefined): string =>
    canonicalizeFolderName(raw);

/**
 * Validate a CID. Returns a message to show the user, or `null` when acceptable.
 * Expects an already-canonicalized value.
 */
export const validateCid = (canonical: string): string | null =>
    validateFolderName(canonical, {
        reserved: CONSULTATION.reservedNames,
        maxLength: CONSULTATION.maxLength,
        label: "consultation ID",
    });

/** Canonicalize and validate in one step. Throws on an unusable value. */
export const requireValidCid = (raw: string | null | undefined): string => {
    const canonical = canonicalizeCid(raw);
    const error = validateCid(canonical);
    if (error) throw new Error(error);
    return canonical;
};

/**
 * The next free sequential CID given the patient's existing consultation folder names:
 * one past the highest purely-numeric CID, zero-padded to `generatedPadLength` ("001"),
 * growing naturally past "999" → "1000". Pure, so the sequencing rule is unit-testable
 * and reusable by import/sync renumbering.
 */
export const nextSequentialCid = (existingNames: readonly string[]): string => {
    let highest = 0;
    for (const name of existingNames) {
        if (!/^\d+$/.test(name)) continue;
        const value = Number.parseInt(name, 10);
        if (value > highest) highest = value;
    }
    return String(highest + 1).padStart(CONSULTATION.generatedPadLength, "0");
};

/** Case-insensitive keys of every CID this patient already uses, read off the disk. */
export const readTakenCidKeysAsync = async (patientId: string): Promise<Set<string>> => {
    const consultationsRoot = await getExistingConsultationsRootDirForPatientAsync(patientId);
    const taken = new Set<string>();
    if (!consultationsRoot) return taken;
    for (const entry of listEntriesSafe(consultationsRoot)) {
        if (entry instanceof Directory) taken.add(folderNameKey(entry.name));
    }
    return taken;
};

/** The next free sequential CID for a patient, read straight off the disk. */
export const generateCidAsync = async (patientId: string): Promise<string> => {
    const consultationsRoot = await getExistingConsultationsRootDirForPatientAsync(patientId);
    const names: string[] = [];
    if (consultationsRoot) {
        for (const entry of listEntriesSafe(consultationsRoot)) {
            if (entry instanceof Directory) names.push(entry.name);
        }
    }
    return nextSequentialCid(names);
};
