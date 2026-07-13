import { Directory } from "expo-file-system";

import { EMR } from "../../constants/patient";
import {
    canonicalizeFolderName,
    folderNameKey,
    validateFolderName,
} from "../storage/folderNames";
import { listEntriesSafe } from "../storage/fsUtils";
import { getPatientsRootDirectoryAsync, initStorageAsync } from "../storage/roots";

/**
 * The EMR number is the patient's identity (see types/models.ts). It names the patient's folder
 * under `patients/`, so uniqueness is enforced by the filesystem rather than by a lookup:
 * a folder-name collision *is* an EMR collision. That is what lets import/sync dedupe on
 * the EMR alone.
 *
 * Two consequences shape this module:
 *
 * 1. EMR numbers are canonicalized (trimmed + NFC-normalized) before they are ever used as a
 *    folder name, a route param, or an index key. Case is preserved as typed, but `abc123`
 *    and `ABC123` are the same patient — uniqueness is compared case-insensitively, because
 *    a case-insensitive filesystem must never see two folders that differ only in case.
 * 2. The EMR is immutable once a patient is created — renaming the folder would mean moving
 *    every photo (unreliable over SAF) and rewriting every consultation.json. The type system
 *    enforces this: `PatientUpdateInput` has no `emrNumber` field.
 */

/**
 * The EMR as a human reads it: a purely numeric EMR is grouped from the left into
 * `EMR.displayGroupSize` chunks, so `123456789` shows as `123 456 789`. Anything containing
 * a non-digit is shown verbatim — grouping arbitrary identifiers would mangle them. The
 * grouped form is display-only and is never canonicalized, validated, or persisted.
 */
export const formatEmrNumberForDisplay = (emrNumber: string): string => {
    if (!/^\d+$/.test(emrNumber)) return emrNumber;

    const groups: string[] = [];
    for (let i = 0; i < emrNumber.length; i += EMR.displayGroupSize) {
        groups.push(emrNumber.slice(i, i + EMR.displayGroupSize));
    }
    return groups.join(" ");
};

/** Thrown when the EMR a user typed already belongs to another patient on this device. */
export class EmrNumberTakenError extends Error {
    constructor(public readonly emrNumber: string, patientName?: string) {
        const shown = formatEmrNumberForDisplay(emrNumber);
        super(
            patientName
                ? `EMR ${shown} already belongs to ${patientName}.`
                : `EMR ${shown} already belongs to another patient.`,
        );
        this.name = "EmrNumberTakenError";
    }
}

/**
 * The one true stored form of an EMR number (trimmed, NFC-normalized, case preserved).
 * Call this before comparing, storing, or resolving a folder — never persist the raw
 * string the user typed.
 */
export const canonicalizeEmrNumber = (raw: string | null | undefined): string =>
    canonicalizeFolderName(raw);

/**
 * Validate an EMR number for use as an identity. Returns a message to show the user, or
 * `null` when the value is acceptable. Expects an already-canonicalized value.
 */
export const validateEmrNumber = (canonical: string): string | null =>
    validateFolderName(canonical, {
        reserved: EMR.reservedNames,
        maxLength: EMR.maxLength,
        label: "EMR number",
    });

/** Canonicalize and validate in one step. Throws on an unusable value. */
export const requireValidEmrNumber = (raw: string | null | undefined): string => {
    const canonical = canonicalizeEmrNumber(raw);
    const error = validateEmrNumber(canonical);
    if (error) throw new Error(error);
    return canonical;
};

/**
 * Case-insensitive keys of every EMR in use, read straight off the disk — the filesystem is
 * the source of truth, so a stale index row must never make a free EMR look taken. One
 * listing, so the generator can retry cheaply; import loops pass the set in once.
 */
export const readTakenEmrKeysAsync = async (): Promise<Set<string>> => {
    const patientsRoot = await getPatientsRootDirectoryAsync();
    const taken = new Set<string>();
    for (const entry of listEntriesSafe(patientsRoot)) {
        if (entry instanceof Directory) taken.add(folderNameKey(entry.name));
    }
    return taken;
};

/** A random `digits`-long numeric string with a non-zero leading digit. */
const randomNumericString = (digits: number): string => {
    let value = String(1 + Math.floor(Math.random() * 9));
    for (let i = 1; i < digits; i += 1) {
        value += Math.floor(Math.random() * 10);
    }
    return value;
};

/**
 * A fresh numeric EMR that no patient on this device holds. Purely numeric by design — a
 * generated identifier the clinician did not choose should not look like a typed one.
 * Pass `taken` when generating in a loop (import) to avoid re-listing the disk per call.
 */
export const generateEmrNumberAsync = async (taken?: Set<string>): Promise<string> => {
    await initStorageAsync();
    const takenKeys = taken ?? (await readTakenEmrKeysAsync());

    for (let attempt = 0; attempt < EMR.maxGenerateAttempts; attempt += 1) {
        const candidate = randomNumericString(EMR.generatedDigits);
        if (!takenKeys.has(candidate)) return candidate;
    }

    throw new Error("Couldn't find an unused EMR number. Please enter one manually.");
};
