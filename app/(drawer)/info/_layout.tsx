import { DrawerToggleButton } from "@react-navigation/drawer";
import { Stack } from "expo-router";

/**
 * Nested stack for the "Info" drawer destination. The index screen is the
 * section menu (with a drawer toggle); every other screen is pushed on top
 * with a standard back button.
 */
export default function InfoLayout() {
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: "#0f172a" },
        headerTintColor: "white",
        headerTitleStyle: { fontWeight: "600" },
        contentStyle: { backgroundColor: "#f8fafc" },
      }}
    >
      <Stack.Screen
        name="index"
        options={{
          title: "Info",
          headerLeft: () => <DrawerToggleButton tintColor="white" />,
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
