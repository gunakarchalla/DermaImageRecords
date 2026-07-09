import { colorScheme } from "nativewind";
import {
    createContext,
    useCallback,
    useContext,
    useEffect,
    useMemo,
    useRef,
    useState,
    type ReactNode,
} from "react";

import {
    DEFAULT_IMAGE_SETTINGS,
    IMAGE_PRESETS,
    PREFERENCES,
    clampFontStep,
    fontScaleForStep,
    matchImagePreset,
    normalizeImageSettings,
    type ImagePresetKey,
    type ImageSettings,
    type ThemePreference,
} from "../../constants/preferences";
import { setGlobalFontScale } from "./fontScaling";
import { setActiveImageSettings } from "./imageSettings";
import { readPreferencesAsync, writePreferencesAsync, type StoredPreferences } from "./preferencesStore";

type SettingsContextValue = {
    /** True once persisted prefs have been loaded (avoids a flash of defaults). */
    ready: boolean;
    theme: ThemePreference;
    fontStep: number;
    fontScale: number;
    /** How newly captured/picked photos are encoded before they're written to disk. */
    imageSettings: ImageSettings;
    /** The preset `imageSettings` matches, or `null` when the user has customised them. */
    imagePresetKey: ImagePresetKey | null;
    setTheme: (theme: ThemePreference) => void;
    toggleTheme: () => void;
    setFontStep: (step: number) => void;
    setImageSettings: (settings: ImageSettings) => void;
    applyImagePreset: (key: ImagePresetKey) => void;
};

const SettingsContext = createContext<SettingsContextValue | null>(null);

const DEFAULT_PREFERENCES: StoredPreferences = {
    theme: PREFERENCES.defaultTheme,
    fontStep: PREFERENCES.defaultFontStep,
    image: DEFAULT_IMAGE_SETTINGS,
};

const applyTheme = (theme: ThemePreference) => {
    // NativeWind drives `dark:` variants off the color scheme. Setting it
    // explicitly (not "system") makes the in-app toggle authoritative.
    colorScheme.set(theme);
};

export function SettingsProvider({ children }: { children: ReactNode }) {
    const [ready, setReady] = useState(false);
    const [prefs, setPrefs] = useState<StoredPreferences>(DEFAULT_PREFERENCES);

    // Mirrors `prefs` so an update can merge into the latest snapshot without
    // either depending on it or running side effects inside a state updater.
    const prefsRef = useRef(prefs);

    // Load persisted preferences once and apply them to the running app.
    useEffect(() => {
        let cancelled = false;
        void (async () => {
            const stored = await readPreferencesAsync();
            const next: StoredPreferences = {
                theme: stored.theme ?? PREFERENCES.defaultTheme,
                fontStep: clampFontStep(stored.fontStep ?? PREFERENCES.defaultFontStep),
                image: normalizeImageSettings(stored.image),
            };

            applyTheme(next.theme);
            setGlobalFontScale(fontScaleForStep(next.fontStep));
            setActiveImageSettings(next.image);

            if (cancelled) return;
            prefsRef.current = next;
            setPrefs(next);
            setReady(true);
        })();
        return () => {
            cancelled = true;
        };
    }, []);

    const update = useCallback((patch: Partial<StoredPreferences>) => {
        const next = { ...prefsRef.current, ...patch };
        prefsRef.current = next;
        setPrefs(next);
        void writePreferencesAsync(next);
    }, []);

    const setTheme = useCallback(
        (next: ThemePreference) => {
            applyTheme(next);
            update({ theme: next });
        },
        [update],
    );

    const toggleTheme = useCallback(() => {
        setTheme(prefs.theme === "dark" ? "light" : "dark");
    }, [setTheme, prefs.theme]);

    const setFontStep = useCallback(
        (step: number) => {
            const clamped = clampFontStep(step);
            setGlobalFontScale(fontScaleForStep(clamped));
            update({ fontStep: clamped });
        },
        [update],
    );

    const setImageSettings = useCallback(
        (settings: ImageSettings) => {
            const normalized = normalizeImageSettings(settings);
            // Photo encoding reads this cache, not the context — see imageSettings.ts.
            setActiveImageSettings(normalized);
            update({ image: normalized });
        },
        [update],
    );

    const applyImagePreset = useCallback(
        (key: ImagePresetKey) => {
            const preset = IMAGE_PRESETS.find((candidate) => candidate.key === key);
            if (preset) setImageSettings(preset.settings);
        },
        [setImageSettings],
    );

    const value = useMemo<SettingsContextValue>(
        () => ({
            ready,
            theme: prefs.theme,
            fontStep: prefs.fontStep,
            fontScale: fontScaleForStep(prefs.fontStep),
            imageSettings: prefs.image,
            imagePresetKey: matchImagePreset(prefs.image),
            setTheme,
            toggleTheme,
            setFontStep,
            setImageSettings,
            applyImagePreset,
        }),
        [ready, prefs, setTheme, toggleTheme, setFontStep, setImageSettings, applyImagePreset],
    );

    return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export const useSettings = (): SettingsContextValue => {
    const ctx = useContext(SettingsContext);
    if (!ctx) {
        throw new Error("useSettings must be used within a SettingsProvider.");
    }
    return ctx;
};
