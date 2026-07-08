import { useColorScheme } from "nativewind";
import { useMemo } from "react";

// Hex colors for the places NativeWind classes can't reach: <Feather> icon
// `color` props, `placeholderTextColor`, ActivityIndicator, and React Navigation
// options. Keep these in sync with the slate palette used via `className`.

export type ThemeColors = {
    // Screen + surface backgrounds (mirror className bg-* choices).
    background: string;
    surface: string;
    // Text-adjacent icon tints.
    iconStrong: string;
    icon: string;
    iconMuted: string;
    // Semantic.
    danger: string;
    accent: string;
    placeholder: string;
    border: string;
    // React Navigation chrome.
    headerBackground: string;
    headerTint: string;
    tabBarBackground: string;
    tabBarActiveTint: string;
    tabBarInactiveTint: string;
};

const lightColors: ThemeColors = {
    background: "#f8fafc", // slate-50
    surface: "#ffffff",
    iconStrong: "#0f172a", // slate-900
    icon: "#475569", // slate-600
    iconMuted: "#94a3b8", // slate-400
    danger: "#e11d48", // rose-600
    accent: "#0f172a",
    placeholder: "#94a3b8",
    border: "#e2e8f0", // slate-200
    headerBackground: "#0f172a",
    headerTint: "#ffffff",
    tabBarBackground: "#ffffff",
    tabBarActiveTint: "#0f172a",
    tabBarInactiveTint: "#94a3b8", // slate-400
};

const darkColors: ThemeColors = {
    background: "#020617", // slate-950
    surface: "#0f172a", // slate-900
    iconStrong: "#e2e8f0", // slate-200
    icon: "#94a3b8", // slate-400
    iconMuted: "#64748b", // slate-500
    danger: "#fb7185", // rose-400
    accent: "#e2e8f0",
    placeholder: "#64748b",
    border: "#1e293b", // slate-800
    headerBackground: "#0f172a",
    headerTint: "#ffffff",
    tabBarBackground: "#0f172a", // slate-900
    tabBarActiveTint: "#ffffff",
    tabBarInactiveTint: "#64748b", // slate-500
};

export const useThemeColors = (): ThemeColors => {
    const { colorScheme } = useColorScheme();
    return useMemo(() => (colorScheme === "dark" ? darkColors : lightColors), [colorScheme]);
};
