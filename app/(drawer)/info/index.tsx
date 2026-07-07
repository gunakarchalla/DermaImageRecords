import { Feather } from "@expo/vector-icons";
import { useRouter, type Href } from "expo-router";
import type { ComponentProps } from "react";
import { Alert, Linking, Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useThemeColors } from "../../../hooks/useThemeColors";

const BUG_REPORT_EMAIL = "challa@gunakar.dev";

type FeatherName = ComponentProps<typeof Feather>["name"];

type InfoItem = {
  key: string;
  label: string;
  description: string;
  icon: FeatherName;
  href?: Href;
  onPress?: () => void | Promise<void>;
};

export default function InfoMenuScreen() {
  const router = useRouter();
  const colors = useThemeColors();

  const reportBug = async () => {
    const url = `mailto:${BUG_REPORT_EMAIL}?subject=${encodeURIComponent(
      "Bug report",
    )}`;
    try {
      const supported = await Linking.canOpenURL(url);
      if (!supported) {
        Alert.alert(
          "No email app found",
          `Please email ${BUG_REPORT_EMAIL} with the subject "Bug report".`,
        );
        return;
      }
      await Linking.openURL(url);
    } catch {
      Alert.alert(
        "Couldn't open email app",
        `Please email ${BUG_REPORT_EMAIL} with the subject "Bug report".`,
      );
    }
  };

  const items: InfoItem[] = [
    {
      key: "about",
      label: "About",
      description: "What DermaImageRecords does",
      icon: "info",
      href: "/info/about",
    },
    {
      key: "creators",
      label: "Creators",
      description: "The people behind the app",
      icon: "users",
      href: "/info/creators",
    },
    {
      key: "ui-ux-guide",
      label: "UI/UX Guide",
      description: "How to get around the app",
      icon: "compass",
      href: "/info/ui-ux-guide",
    },
    {
      key: "license",
      label: "License",
      description: "Terms of use",
      icon: "file-text",
      href: "/info/license",
    },
    {
      key: "privacy-policy",
      label: "Privacy Policy",
      description: "How your data is handled",
      icon: "shield",
      href: "/info/privacy-policy",
    },
    {
      key: "report-bug",
      label: "Report a Bug",
      description: `Email ${BUG_REPORT_EMAIL}`,
      icon: "alert-circle",
      onPress: reportBug,
    },
  ];

  return (
    <SafeAreaView className="flex-1 bg-slate-50 dark:bg-slate-950">
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 48 }}>
        {items.map((item) => (
          <Pressable
            key={item.key}
            accessibilityRole="button"
            onPress={() => (item.href ? router.push(item.href) : item.onPress?.())}
            className="mb-3 flex-row items-center rounded-xl bg-white p-4 shadow-sm dark:bg-slate-900"
          >
            <View className="h-11 w-11 items-center justify-center rounded-full bg-slate-100 dark:bg-slate-800">
              <Feather name={item.icon} size={20} color={colors.iconStrong} />
            </View>
            <View className="ml-4 flex-1">
              <Text className="text-base font-semibold text-slate-900 dark:text-slate-100">
                {item.label}
              </Text>
              <Text className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">
                {item.description}
              </Text>
            </View>
            <Feather name="chevron-right" size={20} color={colors.iconMuted} />
          </Pressable>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}
