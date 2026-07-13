import { Stack } from "expo-router";

import { DrawerMenuButton } from "../../../components/ui/DrawerMenuButton";
import { useThemeColors } from "../../../hooks/useThemeColors";

/**
 * Nested stack for the "Info" drawer destination. The index screen is the
 * section menu (with a hamburger, since it is a drawer destination); every
 * other screen is pushed on top with a standard back button.
 */
export default function InfoLayout() {
  const colors = useThemeColors();

  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: colors.headerBackground },
        headerTintColor: colors.headerTint,
        headerTitleStyle: { fontWeight: "600" },
        contentStyle: { backgroundColor: colors.background },
      }}
    >
      <Stack.Screen
        name="index"
        options={{
          title: "Info",
          headerLeft: () => <DrawerMenuButton tint={colors.headerTint} />,
        }}
      />
      <Stack.Screen name="about" options={{ title: "About" }} />
      <Stack.Screen name="creators" options={{ title: "Creators" }} />
      <Stack.Screen name="license" options={{ title: "License" }} />
      <Stack.Screen
        name="privacy-policy"
        options={{ title: "Privacy Policy" }}
      />
    </Stack>
  );
}
