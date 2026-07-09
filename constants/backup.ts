// Cloud-backup configuration. The dataset on disk stays the source-of-truth (see
// CLAUDE.md); a cloud backup is just a copy of the export .zip pushed to the user's
// Google Drive. These are user preferences + fixed identifiers, persisted as config
// in the app sandbox (see services/backup/backupSettingsStore.ts).

export type BackupMode = "off" | "manual" | "automatic";

// "custom" means "use customDays"; the others map to a fixed number of days.
export type BackupPeriodKey = "daily" | "weekly" | "monthly" | "custom";

export const BACKUP_PERIOD_PRESETS: {
    key: Exclude<BackupPeriodKey, "custom">;
    label: string;
    days: number;
}[] = [
    { key: "daily", label: "Daily", days: 1 },
    { key: "weekly", label: "Weekly", days: 7 },
    { key: "monthly", label: "Monthly", days: 30 },
];

export const BACKUP = {
    // Sandbox config file (config, not dataset data) — mirrors PREFERENCES.fileName.
    fileName: "DermaImageRecords.backup.json",

    // Keep-only-latest retention: a single Drive file we overwrite each backup.
    driveFileName: "DermaImageRecords-backup.zip",
    driveMimeType: "application/zip",

    // Minimal Drive scope: the app can only see files it created itself.
    driveScope: "https://www.googleapis.com/auth/drive.file",

    defaultMode: "off" as BackupMode,
    defaultPeriodKey: "weekly" as BackupPeriodKey,
    defaultCustomDays: 3,
    minCustomDays: 1,
    maxCustomDays: 90,

    // A failed automatic backup is retried on an exponential backoff rather than waiting
    // for the next foreground or the next period. Delays: 1, 2, 4, 8, 16 minutes (capped),
    // after which we stop and let the next foreground / due-check start over.
    retryBaseDelayMs: 60_000,
    retryMaxDelayMs: 30 * 60_000,
    maxRetryAttempts: 5,
} as const;

export const clampCustomDays = (days: number): number =>
    Math.min(Math.max(Math.round(days), BACKUP.minCustomDays), BACKUP.maxCustomDays);

/** Resolve a period selection to its interval in days. */
export const periodDays = (periodKey: BackupPeriodKey, customDays: number): number => {
    if (periodKey === "custom") return clampCustomDays(customDays);
    const preset = BACKUP_PERIOD_PRESETS.find((p) => p.key === periodKey);
    return preset?.days ?? 7;
};

/**
 * Delay before the `attempt`-th consecutive retry of a failed automatic backup (1-based),
 * doubling each time and capped at `retryMaxDelayMs`.
 */
export const retryDelayMs = (attempt: number): number =>
    Math.min(
        BACKUP.retryBaseDelayMs * 2 ** Math.max(0, attempt - 1),
        BACKUP.retryMaxDelayMs,
    );

/** Human-readable summary of the selected period, e.g. "Weekly" or "Every 3 days". */
export const periodLabel = (periodKey: BackupPeriodKey, customDays: number): string => {
    if (periodKey === "custom") {
        const days = clampCustomDays(customDays);
        return days === 1 ? "Every day" : `Every ${days} days`;
    }
    return BACKUP_PERIOD_PRESETS.find((p) => p.key === periodKey)?.label ?? "Weekly";
};
