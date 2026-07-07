import { Feather } from "@expo/vector-icons";
import { Text, View } from "react-native";

type FeatureInDevelopmentProps = {
  title: string;
};

/**
 * Placeholder shown for destinations that are not built yet
 * (Settings, Account, Import/Export, UI/UX Guide).
 */
export function FeatureInDevelopment({ title }: FeatureInDevelopmentProps) {
  return (
    <View className="flex-1 items-center justify-center bg-slate-50 px-8">
      <View className="h-16 w-16 items-center justify-center rounded-full bg-slate-200">
        <Feather name="tool" size={28} color="#475569" />
      </View>
      <Text className="mt-4 text-xl font-bold text-slate-900">{title}</Text>
      <Text className="mt-2 text-center text-base text-slate-500">
        This feature is in development.
      </Text>
    </View>
  );
}
