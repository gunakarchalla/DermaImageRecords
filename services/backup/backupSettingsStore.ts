import { File, Paths } from "expo-file-system";

import {
    BACKUP,
    clampCustomDays,
    type BackupMode,
    type BackupPeriodKey,
} from "../../constants/backup";

// Cloud-backup settings live in the app sandbox (Documents), mirroring the theme /
// font preferences store. This is config, not dataset data, so it stays in the
// sandbox and is never written to the user-picked SAF folder.
//
// `lastBackupAt` (epoch ms) and `driveFileId` are runtime state persisted alongside
// the user's choices: `lastBackupAt` drives the "period elapsed?" check for automatic
// backups, and `driveFileId` implements keep-only-latest by pointing at the single
// Drive file we overwrite each time.

export type StoredBackupSettings = {
    mode: BackupMode;
    periodKey: BackupPeriodKey;
    customDays: number;
    lastBackupAt: number | null;
    driveFileId: string | null;
};

export const DEFAULT_BACKUP_SETTINGS: StoredBackupSettings = {
    mode: BACKUP.defaultMode,
    periodKey: BACKUP.defaultPeriodKey,
    customDays: BACKUP.defaultCustomDays,
    lastBackupAt: null,
    driveFileId: null,
};

const BACKUP_FILE = new File(Paths.document, BACKUP.fileName);

const isMode = (value: unknown): value is BackupMode =>
    value === "off" || value === "manual" || value === "automatic";

const isPeriodKey = (value: unknown): value is BackupPeriodKey =>
    value === "daily" || value === "weekly" || value === "monthly" || value === "custom";

export const readBackupSettingsAsync = async (): Promise<StoredBackupSettings> => {
    try {
        if (!BACKUP_FILE.exists) return { ...DEFAULT_BACKUP_SETTINGS };
        const raw = await BACKUP_FILE.text();
        const parsed = JSON.parse(raw) as Partial<StoredBackupSettings>;
        return {
            mode: isMode(parsed.mode) ? parsed.mode : DEFAULT_BACKUP_SETTINGS.mode,
            periodKey: isPeriodKey(parsed.periodKey)
                ? parsed.periodKey
                : DEFAULT_BACKUP_SETTINGS.periodKey,
            customDays:
                typeof parsed.customDays === "number"
                    ? clampCustomDays(parsed.customDays)
                    : DEFAULT_BACKUP_SETTINGS.customDays,
            lastBackupAt:
                typeof parsed.lastBackupAt === "number" ? parsed.lastBackupAt : null,
            driveFileId: typeof parsed.driveFileId === "string" ? parsed.driveFileId : null,
        };
    } catch {
        // Corrupt/unreadable config should never crash the app; fall back to defaults.
        return { ...DEFAULT_BACKUP_SETTINGS };
    }
};

export const writeBackupSettingsAsync = async (
    settings: StoredBackupSettings,
): Promise<void> => {
    try {
        BACKUP_FILE.create({ intermediates: true, overwrite: true });
        BACKUP_FILE.write(JSON.stringify(settings, null, 2));
    } catch {
        // Best-effort persistence; a failed write just means settings reset next launch.
    }
};
