import { Feather } from "@expo/vector-icons";
import { FlashList } from "@shopify/flash-list";
import { useColorScheme } from "nativewind";
import { useCallback, useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useThemeColors } from "../../hooks/useThemeColors";

export type SelectItem = {
  key: string;
  label: string;
  sublabel?: string;
};

type Props = {
  title: string;
  subtitle?: string;
  items: SelectItem[];
  confirmLabel: string;
  onCancel: () => void;
  onConfirm: (keys: string[]) => void;
};

/**
 * Full-screen multi-select sheet used by selective export ("which patients / which
 * visits?") and the patient-summary PDF. Selection colors are inline `style` per the
 * css-interop constraint (see components/ui/SegmentedControl.tsx).
 */
export function ExportSelectSheet({
  title,
  subtitle,
  items,
  confirmLabel,
  onCancel,
  onConfirm,
}: Props) {
  const colors = useThemeColors();
  const { colorScheme } = useColorScheme();
  const isDark = colorScheme === "dark";
  const insets = useSafeAreaInsets();

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const allSelected = selected.size === items.length && items.length > 0;

  const toggle = useCallback((key: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const toggleAll = useCallback(() => {
    setSelected((prev) =>
      prev.size === items.length ? new Set() : new Set(items.map((i) => i.key)),
    );
  }, [items]);

  const checkColors = useMemo(
    () => ({
      onBg: isDark ? "#f1f5f9" : "#0f172a",
      onTint: isDark ? "#0f172a" : "#ffffff",
      offBorder: isDark ? "#475569" : "#cbd5e1",
    }),
    [isDark],
  );

  const renderItem = useCallback(
    ({ item }: { item: SelectItem }) => {
      const isOn = selected.has(item.key);
      return (
        <Pressable
          onPress={() => toggle(item.key)}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: isOn }}
          className="mb-2 flex-row items-center rounded-xl bg-white p-3 dark:bg-slate-900"
        >
          <View
            className="h-6 w-6 items-center justify-center rounded-md"
            style={{
              backgroundColor: isOn ? checkColors.onBg : "transparent",
              borderWidth: isOn ? 0 : 2,
              borderColor: checkColors.offBorder,
            }}
          >
            {isOn ? <Feather name="check" size={16} color={checkColors.onTint} /> : null}
          </View>
          <View className="ml-3 flex-1">
            <Text className="text-base font-medium text-slate-900 dark:text-slate-100">
              {item.label}
            </Text>
            {item.sublabel ? (
              <Text className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                {item.sublabel}
              </Text>
            ) : null}
          </View>
        </Pressable>
      );
    },
    [checkColors, selected, toggle],
  );

  return (
    <View className="absolute inset-0 bg-slate-50 dark:bg-slate-950" style={{ paddingTop: insets.top }}>
      <View className="flex-row items-center justify-between px-4 pb-2 pt-4">
        <View className="flex-1 pr-3">
          <Text className="text-xl font-bold text-slate-900 dark:text-slate-100">{title}</Text>
          {subtitle ? (
            <Text className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{subtitle}</Text>
          ) : null}
        </View>
        <Pressable onPress={onCancel} className="p-2" accessibilityLabel="Cancel selection">
          <Feather name="x" size={24} color={colors.iconStrong} />
        </Pressable>
      </View>

      <View className="px-4 pb-2">
        <Pressable onPress={toggleAll} accessibilityRole="button" className="flex-row items-center py-1">
          <Feather
            name={allSelected ? "check-square" : "square"}
            size={16}
            color={colors.iconStrong}
          />
          <Text className="ml-2 text-sm font-semibold text-slate-700 dark:text-slate-300">
            {allSelected ? "Deselect all" : "Select all"}
          </Text>
        </Pressable>
      </View>

      <FlashList
        data={items}
        keyExtractor={(item) => item.key}
        renderItem={renderItem}
        extraData={selected}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 16 }}
      />

      <View
        className="border-t border-slate-200 bg-white px-4 pt-3 dark:border-slate-800 dark:bg-slate-900"
        style={{ paddingBottom: Math.max(insets.bottom, 12) }}
      >
        <Pressable
          onPress={() => onConfirm([...selected])}
          disabled={selected.size === 0}
          className="h-12 flex-row items-center justify-center rounded-lg bg-slate-900 dark:bg-slate-100"
          style={{ opacity: selected.size === 0 ? 0.5 : 1 }}
        >
          <Text className="text-base font-semibold text-white dark:text-slate-900">
            {confirmLabel}
            {selected.size > 0 ? ` (${selected.size})` : ""}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}
