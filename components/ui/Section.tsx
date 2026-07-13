import { Feather } from "@expo/vector-icons";
import type { ComponentProps, ReactNode } from "react";
import { Text, View } from "react-native";

import { useThemeColors } from "../../hooks/useThemeColors";

type Props = {
  icon: ComponentProps<typeof Feather>["name"];
  title: string;
  subtitle: string;
  children: ReactNode;
};

/** Titled settings-style card: icon + uppercase label above a white panel. */
export function Section({ icon, title, subtitle, children }: Props) {
  const colors = useThemeColors();

  return (
    <View className="mb-5">
      <View className="mb-2 flex-row items-center">
        <Feather name={icon} size={16} color={colors.icon} />
        <Text className="ml-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
          {title}
        </Text>
      </View>
      <View className="rounded-xl bg-white p-4 shadow-sm dark:bg-slate-900">
        <Text className="text-sm text-slate-500 dark:text-slate-400">{subtitle}</Text>
        <View className="mt-3">{children}</View>
      </View>
    </View>
  );
}
