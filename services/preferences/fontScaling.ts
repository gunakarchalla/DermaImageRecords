import { rem } from "nativewind";

// App-wide font scaling.
//
// NativeWind resolves every Tailwind sizing class that's defined in `rem`
// (`text-*` font sizes, and rem-based spacing) against a single global `rem`
// observable at render time. Its default is 14 — React Native's de-facto default
// text size. Crucially, `rem` is reactive: changing it re-runs the style
// computation for every mounted styled component, so the new size takes effect
// live across the whole app (including this setting's own preview), independent
// of React's render memoization.
//
// We scale text by moving the rem base: `rem = BASE_REM * scale`. A scale of 1
// restores NativeWind's default, so default rendering is untouched until the
// user changes the setting.
//
// Note: because NativeWind derives rem-based spacing from the same base, the UI
// scales proportionally (text and its surrounding padding grow together) rather
// than only fontSize — this avoids text overflowing fixed-size containers.

// NativeWind's default rem, matching React Native's default <Text> size.
const BASE_REM = 14;

/**
 * Set the app-wide font scale. Takes effect immediately on every styled
 * component via NativeWind's reactive `rem` unit.
 */
export const setGlobalFontScale = (scale: number) => {
    rem.set(BASE_REM * scale);
};
