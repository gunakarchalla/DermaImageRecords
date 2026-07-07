import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { useThemeColors } from "../hooks/useThemeColors";
import { installGlobalFontScaling } from "../services/preferences/fontScaling";
import { SettingsProvider } from "../services/preferences/SettingsProvider";
import "../services/nativewindInterop";
import "./global.css";

// Patch <Text>/<TextInput> once so the in-app font-size setting scales all text.
installGlobalFontScaling();

function RootNavigator() {
  // useThemeColors subscribes to the color scheme, so this restyles on toggle.
  const colors = useThemeColors();

  return (
    <>
      {/* Header is dark navy in both themes, so light status-bar text fits both. */}
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: colors.headerBackground },
          headerTintColor: colors.headerTint,
          headerTitleStyle: { fontWeight: "600" },
          contentStyle: { backgroundColor: colors.background },
        }}
      >
        {/* The (drawer) group renders its own header (with the menu
            button), so suppress the parent Stack header for it. */}
        <Stack.Screen name="(drawer)" options={{ headerShown: false }} />
      </Stack>
    </>
  );
}

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <SettingsProvider>
          <RootNavigator />
        </SettingsProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
