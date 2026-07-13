import { Feather } from "@expo/vector-icons";
import type { ComponentProps } from "react";
import { Text, View } from "react-native";

import { useThemeColors } from "../../hooks/useThemeColors";

type Props = {
  icon: ComponentProps<typeof Feather>["name"];
  title: string;
  message?: string;
};

/** Centered icon + title + optional message, for empty lists and not-yet-loaded screens. */
export function EmptyState({ icon, title, message }: Props) {
  const colors = useThemeColors();

  return (
    <View className="flex-1 items-center justify-center px-8">
      <Feather name={icon} size={32} color={colors.iconMuted} />
      <Text className="mt-3 text-base font-semibold text-slate-900 dark:text-slate-100">
        {title}
      </Text>
      {message ? (
        <Text className="mt-1 text-center text-sm text-slate-500 dark:text-slate-400">
          {message}
        </Text>
      ) : null}
    </View>
  );
}
