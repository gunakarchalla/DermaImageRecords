import { Stack } from "expo-router";

import { useThemeColors } from "../../../hooks/useThemeColors";

/**
 * Nested stack for the "Info" tab destination. The index screen is the
 * section menu; every other screen is pushed on top with a standard back
 * button.
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
        }}
      />
      <Stack.Screen name="about" options={{ title: "About" }} />
      <Stack.Screen name="creators" options={{ title: "Creators" }} />
      <Stack.Screen name="ui-ux-guide" options={{ title: "UI/UX Guide" }} />
      <Stack.Screen name="license" options={{ title: "License" }} />
      <Stack.Screen
        name="privacy-policy"
        options={{ title: "Privacy Policy" }}
      />
    </Stack>
  );
}
