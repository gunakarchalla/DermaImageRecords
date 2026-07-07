// User-facing app preferences (theme + font size).
// Persisted as config (not data) in the app sandbox — see services/preferences.
// The filesystem dataset remains the source-of-truth for records; these are UI prefs only.

export type ThemePreference = "light" | "dark";

export const PREFERENCES = {
    // Stored in app sandbox Documents (config, not data).
    fileName: "DermaImageRecords.preferences.json",
    defaultTheme: "light" as ThemePreference,
    // Index into FONT_SCALE_STEPS.
    defaultFontStep: 1,
} as const;

// Stepped, app-wide font sizing. `scale` multiplies every explicit fontSize
// at render time (see services/preferences/fontScaling.ts).
export const FONT_SCALE_STEPS = [
    { key: "small", label: "Small", scale: 0.85 },
    { key: "default", label: "Default", scale: 1.0 },
    { key: "large", label: "Large", scale: 1.15 },
    { key: "xlarge", label: "Extra Large", scale: 1.3 },
] as const;

export const clampFontStep = (step: number): number =>
    Math.min(Math.max(Math.round(step), 0), FONT_SCALE_STEPS.length - 1);

export const fontScaleForStep = (step: number): number =>
    FONT_SCALE_STEPS[clampFontStep(step)].scale;
