import {
    DEFAULT_IMAGE_SETTINGS,
    normalizeImageSettings,
    type ImageSettings,
} from "../../constants/preferences";
import { readPreferencesAsync } from "./preferencesStore";

// Photo encoding happens deep inside services/storage, far outside React, so the
// active image settings are mirrored into a module-level cache — the same
// side-effect channel `fontScaling.ts` uses for the global rem. SettingsProvider
// pushes on hydration and on every change.
//
// The async getter exists only for encodes that race ahead of the provider (a
// deep link straight into the camera, say). It reads the persisted file directly
// so a save never silently falls back to defaults the user didn't choose.

let activeSettings: ImageSettings | null = null;
let hydration: Promise<ImageSettings> | null = null;

export const setActiveImageSettings = (settings: ImageSettings): void => {
    activeSettings = settings;
};

export const getActiveImageSettingsAsync = async (): Promise<ImageSettings> => {
    if (activeSettings) return activeSettings;

    // Single-flight: concurrent saves before hydration share one disk read.
    hydration ??= readPreferencesAsync()
        .then((stored) => {
            const settings = normalizeImageSettings(stored.image);
            activeSettings ??= settings;
            return settings;
        })
        .catch(() => DEFAULT_IMAGE_SETTINGS)
        .finally(() => {
            hydration = null;
        });

    return hydration;
};
