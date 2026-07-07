import { StyleSheet, Text, TextInput } from "react-native";

// App-wide font scaling.
//
// React Native does not cascade `fontSize` from a parent View, so a global font
// size can't be applied with a single wrapper style. Instead we patch the render
// of the core <Text> and <TextInput> components once at startup: on every render
// we multiply the component's effective `fontSize` by the current scale.
//
// If a component has an explicit numeric `fontSize` (what NativeWind resolves
// `text-*` classes into) we scale that; otherwise we scale React Native's default
// size so unsized labels (e.g. `font-semibold` with no `text-*`) still respond.
// The patch is a no-op at scale 1, so default rendering is untouched until the
// user changes the setting.

// React Native's de-facto default <Text> size on both platforms.
const DEFAULT_FONT_SIZE = 14;

let currentFontScale = 1;

/**
 * Set the multiplier applied to every explicit fontSize. Takes effect on the
 * next render of each text component (screens re-render on focus / theme change).
 */
export const setGlobalFontScale = (scale: number) => {
    currentFontScale = scale;
};

type PatchableComponent = {
    render?: (props: Record<string, unknown>, ref: unknown) => unknown;
    __dermaFontScalePatched?: boolean;
};

const scaleStyleProp = (style: unknown): unknown => {
    if (currentFontScale === 1) return style;
    const flattened = StyleSheet.flatten(style as never) as { fontSize?: number } | undefined;
    const base = typeof flattened?.fontSize === "number" ? flattened.fontSize : DEFAULT_FONT_SIZE;
    return [style, { fontSize: base * currentFontScale }];
};

const patchComponentRender = (Component: unknown) => {
    const target = Component as PatchableComponent;
    if (!target || typeof target.render !== "function" || target.__dermaFontScalePatched) {
        return;
    }

    const originalRender = target.render.bind(target);
    target.render = (props, ref) => {
        const scaledStyle = scaleStyleProp((props as { style?: unknown }).style);
        const nextProps =
            scaledStyle === (props as { style?: unknown }).style
                ? props
                : { ...props, style: scaledStyle };
        return originalRender(nextProps, ref);
    };
    target.__dermaFontScalePatched = true;
};

let patched = false;

/**
 * Install the font-scaling patch. Safe to call multiple times; only patches once.
 * Imported for its side effect from the root layout.
 */
export const installGlobalFontScaling = () => {
    if (patched) return;
    patched = true;
    patchComponentRender(Text);
    patchComponentRender(TextInput);
};
