import Constants from "expo-constants";
import { Platform } from "react-native";

/**
 * Metadata written at the root of every backup archive as `backup.json`, and read back on
 * import/restore. It never affects *what* is imported (identity is still the EMR / consultation
 * stamp) — it drives the "restored from…" confirmation and gives the merge UI context (whose
 * backup this is, and how it compares to local data).
 *
 * The manifest lives at the archive root, so `groupEntriesByPatient` (which only looks under
 * `patients/`) ignores it, and archives produced before this feature simply parse as `null`.
 */

/** v2: the dataset inside is data-model v2 (uids, CIDs, relative paths, thumbs). */
export const MANIFEST_SCHEMA_VERSION = 2;
export const MANIFEST_FILE_NAME = "backup.json";

export type BackupCounts = {
    patients: number;
    consultations: number;
    photos: number;
};

export type BackupManifest = {
    schemaVersion: number;
    appVersion: string | null;
    /** ISO timestamp the archive was written. */
    exportedAt: string;
    account: { email: string | null };
    deviceName: string | null;
    platform: string;
    counts: BackupCounts;
};

export const buildManifest = (input: {
    counts: BackupCounts;
    email: string | null;
}): BackupManifest => ({
    schemaVersion: MANIFEST_SCHEMA_VERSION,
    appVersion: Constants.expoConfig?.version ?? null,
    exportedAt: new Date().toISOString(),
    account: { email: input.email },
    // `deviceName` is best-effort; expo-constants exposes it but may omit it on some platforms.
    deviceName: (Constants as { deviceName?: string }).deviceName ?? null,
    platform: Platform.OS,
    counts: input.counts,
});

/**
 * Parse a manifest read from an archive. Returns null for a missing/old/corrupt manifest so
 * callers can treat "no provenance" uniformly. Only the fields the app relies on are validated.
 */
export const parseManifest = (raw: string | undefined): BackupManifest | null => {
    if (!raw) return null;
    try {
        const parsed = JSON.parse(raw) as Partial<BackupManifest> & { account?: { email?: unknown } };
        if (typeof parsed.exportedAt !== "string") return null;
        const counts = parsed.counts;
        return {
            schemaVersion: typeof parsed.schemaVersion === "number" ? parsed.schemaVersion : 0,
            appVersion: typeof parsed.appVersion === "string" ? parsed.appVersion : null,
            exportedAt: parsed.exportedAt,
            account: {
                email:
                    typeof parsed.account?.email === "string" ? parsed.account.email : null,
            },
            deviceName: typeof parsed.deviceName === "string" ? parsed.deviceName : null,
            platform: typeof parsed.platform === "string" ? parsed.platform : "unknown",
            counts: {
                patients: typeof counts?.patients === "number" ? counts.patients : 0,
                consultations: typeof counts?.consultations === "number" ? counts.consultations : 0,
                photos: typeof counts?.photos === "number" ? counts.photos : 0,
            },
        };
    } catch {
        return null;
    }
};
