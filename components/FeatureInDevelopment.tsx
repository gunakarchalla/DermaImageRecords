import { Feather } from "@expo/vector-icons";
import { Text, View } from "react-native";

import { useThemeColors } from "../hooks/useThemeColors";

type FeatureInDevelopmentProps = {
  title: string;
};

/**
 * Placeholder shown for destinations that are not built yet
 * (Account, Import/Export).
 */
export function FeatureInDevelopment({ title }: FeatureInDevelopmentProps) {
  const colors = useThemeColors();
  return (
    <View className="flex-1 items-center justify-center bg-slate-50 px-8 dark:bg-slate-950">
      <View className="h-16 w-16 items-center justify-center rounded-full bg-slate-200 dark:bg-slate-800">
        <Feather name="tool" size={28} color={colors.icon} />
      </View>
      <Text className="mt-4 text-xl font-bold text-slate-900 dark:text-slate-100">{title}</Text>
      <Text className="mt-2 text-center text-base text-slate-500 dark:text-slate-400">
        This feature is in development.
      </Text>
    </View>
  );
}
