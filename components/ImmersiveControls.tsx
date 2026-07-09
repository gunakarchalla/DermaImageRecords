import { Feather } from "@expo/vector-icons";
import type { ComponentProps } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

export type FeatherName = ComponentProps<typeof Feather>["name"];

/**
 * The camera and the fullscreen photo viewer are always-dark immersive surfaces
 * (like the compare overlay), so they don't follow the light/dark scheme — they
 * pin to a fixed slate palette instead of going through `useThemeColors`.
 */
export const IMMERSIVE = {
  scrim: "rgba(2,6,23,0.88)", // slate-950
  scrimSoft: "rgba(2,6,23,0.55)",
  control: "rgba(15,23,42,0.62)", // slate-900
  controlBorder: "rgba(148,163,184,0.28)", // slate-400
  active: "#e2e8f0", // slate-200
  onActive: "#0f172a", // slate-900
  icon: "#e2e8f0", // slate-200
  iconMuted: "#64748b", // slate-500
  label: "#94a3b8", // slate-400
  danger: "#fb7185", // rose-400
  hairline: "rgba(226,232,240,0.9)",
} as const;

// Active/disabled visuals below are applied through inline `style`, never by
// swapping Tailwind classes. Toggling a class that adds a shadow or interaction
// style after first render trips css-interop's "View -> Pressable" upgrade path
// and crashes while it stringifies props. Static `text-*` classes stay as classes
// so the global font scaling preference still applies.

type OverlayIconButtonProps = {
  icon: FeatherName;
  accessibilityLabel: string;
  onPress: () => void;
  active?: boolean;
  disabled?: boolean;
  tone?: "default" | "danger";
  size?: number;
};

/** Round translucent control used across the camera and photo-viewer chrome. */
export function OverlayIconButton({
  icon,
  accessibilityLabel,
  onPress,
  active = false,
  disabled = false,
  tone = "default",
  size = 20,
}: OverlayIconButtonProps) {
  const iconColor = disabled
    ? IMMERSIVE.iconMuted
    : active
      ? IMMERSIVE.onActive
      : tone === "danger"
        ? IMMERSIVE.danger
        : IMMERSIVE.icon;

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ selected: active, disabled }}
      hitSlop={8}
      className="items-center justify-center rounded-full"
      style={{
        width: 44,
        height: 44,
        borderWidth: 1,
        backgroundColor: active ? IMMERSIVE.active : IMMERSIVE.control,
        borderColor: active ? IMMERSIVE.active : IMMERSIVE.controlBorder,
        opacity: disabled ? 0.45 : 1,
      }}
    >
      <Feather name={icon} size={size} color={iconColor} />
    </Pressable>
  );
}

type OverlayChipProps = {
  label: string;
  onPress: () => void;
  active?: boolean;
  disabled?: boolean;
};

/** Pill toggle: filled slate-200 when active, outlined when not. */
export function OverlayChip({
  label,
  onPress,
  active = false,
  disabled = false,
}: OverlayChipProps) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: active, disabled }}
      className="rounded-full px-4 py-2"
      style={{
        borderWidth: 1,
        backgroundColor: active ? IMMERSIVE.active : "transparent",
        borderColor: active ? IMMERSIVE.active : IMMERSIVE.controlBorder,
        opacity: disabled ? 0.45 : 1,
      }}
    >
      <Text
        className="text-xs font-semibold"
        style={{ color: active ? IMMERSIVE.onActive : IMMERSIVE.icon }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

/** Small translucent pill for transient status text (zoom level, photo counter). */
export function OverlayPill({ children }: { children: React.ReactNode }) {
  return (
    <View
      className="rounded-full px-3 py-1"
      style={{
        backgroundColor: IMMERSIVE.control,
        borderWidth: 1,
        borderColor: IMMERSIVE.controlBorder,
      }}
    >
      {children}
    </View>
  );
}

/**
 * Rule-of-thirds guides. Used as a framing aid on the camera and as crop guides
 * inside the crop rectangle, where repeatable composition between visits matters.
 */
const THIRDS: `${number}%`[] = ["33.333%", "66.666%"];

export function RuleOfThirdsGrid({ inset = false }: { inset?: boolean }) {
  const lineColor = inset ? "rgba(226,232,240,0.45)" : "rgba(226,232,240,0.3)";

  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      {THIRDS.map((offset) => (
        <View
          key={`v-${offset}`}
          style={{
            position: "absolute",
            left: offset,
            top: 0,
            bottom: 0,
            width: StyleSheet.hairlineWidth * 2,
            backgroundColor: lineColor,
          }}
        />
      ))}
      {THIRDS.map((offset) => (
        <View
          key={`h-${offset}`}
          style={{
            position: "absolute",
            top: offset,
            left: 0,
            right: 0,
            height: StyleSheet.hairlineWidth * 2,
            backgroundColor: lineColor,
          }}
        />
      ))}
    </View>
  );
}
