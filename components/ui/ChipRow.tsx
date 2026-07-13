import { useColorScheme } from "nativewind";
import { Pressable, Text, View } from "react-native";

export type ChipOption<T> = { value: T; label: string };

type Props<T> = {
  options: readonly ChipOption<T>[];
  value: T;
  onChange: (value: T) => void;
  disabled?: boolean;
  /** "md" for form chips (default), "sm" for compact rows like list sort pills. */
  size?: "sm" | "md";
};

/**
 * Wrapping row of selectable pill chips (single-select).
 *
 * Same css-interop constraint as SegmentedControl: selected-state colors are inline
 * `style`, never toggled classes; static `text-*` classes keep font scaling working.
 */
export function ChipRow<T>({ options, value, onChange, disabled = false, size = "md" }: Props<T>) {
  const { colorScheme } = useColorScheme();
  const isDark = colorScheme === "dark";
  const activeBg = isDark ? "#f1f5f9" : "#0f172a"; // slate-100 / slate-900
  const activeText = isDark ? "#0f172a" : "#ffffff";
  const inactiveBorder = isDark ? "#334155" : "#cbd5e1"; // slate-700 / slate-300
  const inactiveBg = isDark ? "#1e293b" : "#ffffff"; // slate-800 / white
  const inactiveText = isDark ? "#e2e8f0" : "#334155"; // slate-200 / slate-700

  const pad =
    size === "sm"
      ? { paddingHorizontal: 12, paddingVertical: 4 }
      : { paddingHorizontal: 16, paddingVertical: 8 };
  const textClass = size === "sm" ? "text-xs font-semibold" : "text-sm font-medium";

  return (
    <View
      style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, opacity: disabled ? 0.5 : 1 }}
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
              borderRadius: 999,
              borderWidth: 1,
              ...pad,
              borderColor: active ? activeBg : inactiveBorder,
              backgroundColor: active ? activeBg : inactiveBg,
            }}
          >
            <Text className={textClass} style={{ color: active ? activeText : inactiveText }}>
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
