import { File, Paths } from "expo-file-system";

import { PREFERENCES, type ImageSettings, type ThemePreference } from "../../constants/preferences";

// Persisted UI preferences live in the app sandbox (Documents), mirroring the
// storage-root config pattern. This is config, not dataset data, so it stays in
// the sandbox and is never written to the user-picked SAF folder.

export type StoredPreferences = {
    theme: ThemePreference;
    fontStep: number;
    image: ImageSettings;
    /** Require biometric/device-credential unlock on open and on return to the app. */
    appLock: boolean;
};

const PREFERENCES_FILE = new File(Paths.document, PREFERENCES.fileName);

export const readPreferencesAsync = async (): Promise<Partial<StoredPreferences>> => {
    try {
        if (!PREFERENCES_FILE.exists) return {};
        const raw = await PREFERENCES_FILE.text();
        const parsed = JSON.parse(raw) as Partial<StoredPreferences>;
        return parsed ?? {};
    } catch {
        // Corrupt/unreadable config should never crash the app; fall back to defaults.
        return {};
    }
};

export const writePreferencesAsync = async (prefs: StoredPreferences): Promise<void> => {
    try {
        PREFERENCES_FILE.create({ intermediates: true, overwrite: true });
        PREFERENCES_FILE.write(JSON.stringify(prefs, null, 2));
    } catch {
        // Best-effort persistence; a failed write just means prefs reset next launch.
    }
};
