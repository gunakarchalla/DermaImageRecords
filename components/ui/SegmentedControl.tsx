import { useColorScheme } from "nativewind";
import { Pressable, Text, View } from "react-native";

export type SegmentedOption<T> = { value: T; label: string };

type Props<T> = {
  options: readonly SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  disabled?: boolean;
};

/**
 * Equal-width segmented selector on a recessed track (e.g. Off / Manual / Automatic).
 *
 * Active/inactive styling is applied via inline `style`, not by toggling Tailwind
 * classes: dynamically changing a class on a css-interop component after first render
 * trips its View→Pressable upgrade path and crashes. Only the non-changing `text-*`
 * classes stay on className so global font scaling still applies. Palette values mirror
 * the hardcoded slate theme (see useThemeColors).
 */
export function SegmentedControl<T>({ options, value, onChange, disabled = false }: Props<T>) {
  const { colorScheme } = useColorScheme();
  const isDark = colorScheme === "dark";
  const trackBg = isDark ? "#1e293b" : "#f1f5f9"; // slate-800 / slate-100
  const activeBg = isDark ? "#475569" : "#ffffff"; // slate-600 / white
  const activeText = isDark ? "#f1f5f9" : "#0f172a"; // slate-100 / slate-900
  const inactiveText = isDark ? "#94a3b8" : "#64748b"; // slate-400 / slate-500

  return (
    <View
      style={{
        flexDirection: "row",
        borderRadius: 8,
        padding: 4,
        backgroundColor: trackBg,
        opacity: disabled ? 0.5 : 1,
      }}
    >
      {options.map((option) => {
        const active = Object.is(option.value, value);
        return (
          <Pressable
            key={option.label}
            onPress={() => onChange(option.value)}
            disabled={disabled}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            style={{
              flex: 1,
              alignItems: "center",
              borderRadius: 6,
              paddingVertical: 8,
              backgroundColor: active ? activeBg : "transparent",
            }}
          >
            <Text
              className="text-sm font-semibold"
              style={{ color: active ? activeText : inactiveText }}
            >
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
