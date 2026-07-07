import { colorScheme } from "nativewind";
import {
    createContext,
    useCallback,
    useContext,
    useEffect,
    useMemo,
    useState,
    type ReactNode,
} from "react";

import {
    PREFERENCES,
    clampFontStep,
    fontScaleForStep,
    type ThemePreference,
} from "../../constants/preferences";
import { setGlobalFontScale } from "./fontScaling";
import { readPreferencesAsync, writePreferencesAsync } from "./preferencesStore";

type SettingsContextValue = {
    /** True once persisted prefs have been loaded (avoids a flash of defaults). */
    ready: boolean;
    theme: ThemePreference;
    fontStep: number;
    fontScale: number;
    setTheme: (theme: ThemePreference) => void;
    toggleTheme: () => void;
    setFontStep: (step: number) => void;
};

const SettingsContext = createContext<SettingsContextValue | null>(null);

const applyTheme = (theme: ThemePreference) => {
    // NativeWind drives `dark:` variants off the color scheme. Setting it
    // explicitly (not "system") makes the in-app toggle authoritative.
    colorScheme.set(theme);
};

export function SettingsProvider({ children }: { children: ReactNode }) {
    const [ready, setReady] = useState(false);
    const [theme, setThemeState] = useState<ThemePreference>(PREFERENCES.defaultTheme);
    const [fontStep, setFontStepState] = useState<number>(PREFERENCES.defaultFontStep);

    // Load persisted preferences once and apply them to the running app.
    useEffect(() => {
        let cancelled = false;
        void (async () => {
            const stored = await readPreferencesAsync();
            const nextTheme = stored.theme ?? PREFERENCES.defaultTheme;
            const nextFontStep = clampFontStep(stored.fontStep ?? PREFERENCES.defaultFontStep);

            applyTheme(nextTheme);
            setGlobalFontScale(fontScaleForStep(nextFontStep));

            if (cancelled) return;
            setThemeState(nextTheme);
            setFontStepState(nextFontStep);
            setReady(true);
        })();
        return () => {
            cancelled = true;
        };
    }, []);

    const persist = useCallback((next: { theme: ThemePreference; fontStep: number }) => {
        void writePreferencesAsync(next);
    }, []);

    const setTheme = useCallback(
        (next: ThemePreference) => {
            applyTheme(next);
            setThemeState(next);
            setFontStepState((currentStep) => {
                persist({ theme: next, fontStep: currentStep });
                return currentStep;
            });
        },
        [persist],
    );

    const toggleTheme = useCallback(() => {
        setTheme(theme === "dark" ? "light" : "dark");
    }, [setTheme, theme]);

    const setFontStep = useCallback(
        (step: number) => {
            const clamped = clampFontStep(step);
            setGlobalFontScale(fontScaleForStep(clamped));
            setFontStepState(clamped);
            setThemeState((currentTheme) => {
                persist({ theme: currentTheme, fontStep: clamped });
                return currentTheme;
            });
        },
        [persist],
    );

    const value = useMemo<SettingsContextValue>(
        () => ({
            ready,
            theme,
            fontStep,
            fontScale: fontScaleForStep(fontStep),
            setTheme,
            toggleTheme,
            setFontStep,
        }),
        [ready, theme, fontStep, setTheme, toggleTheme, setFontStep],
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
