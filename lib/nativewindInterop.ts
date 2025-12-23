import { Image as ExpoImage } from "expo-image";
import { cssInterop } from "nativewind";

/**
 * NativeWind only applies `className` automatically to core React Native components.
 * `expo-image` is a third-party component, so without `cssInterop` the `className`
 * prop will be ignored at runtime, leading to images rendering with no size.
 *
 * Call this module once at app startup (see `app/_layout.tsx`).
 */
cssInterop(ExpoImage, {
    className: "style",
});
