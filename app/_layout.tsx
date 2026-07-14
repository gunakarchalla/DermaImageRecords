import { Stack, useRouter, useSegments } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { ActivityIndicator, InteractionManager, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { useThemeColors } from "../hooks/useThemeColors";
import { AuthProvider, useAuth } from "../services/auth/AuthProvider";
import { SettingsProvider } from "../services/preferences/SettingsProvider";
import { sweepTempFilesAsync } from "../services/storage/tempSweep";
import { SyncProvider } from "../services/sync/SyncProvider";
import "../services/nativewindInterop";
import "./global.css";

// Redirect guard: gates *every* route by watching the active segments, so deep
// links into patient/* screens can't bypass the login when signed out. Runs
// alongside the Stack.Protected group entries below (which additionally keep the
// patient list from mounting at all on the normal signed-out cold start).
function useAuthRedirect(isSignedIn: boolean, loading: boolean) {
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    if (loading) return; // wait until the persisted session is restored
    const inAuthGroup = segments[0] === "(auth)";

    if (!isSignedIn && !inAuthGroup) {
      router.replace("/(auth)/sign-in");
    } else if (isSignedIn && inAuthGroup) {
      router.replace("/(drawer)/(tabs)");
    }
  }, [isSignedIn, loading, segments, router]);
}

function RootNavigator() {
  // useThemeColors subscribes to the color scheme, so this restyles on toggle.
  const colors = useThemeColors();
  const { isSignedIn, loading } = useAuth();

  useAuthRedirect(isSignedIn, loading);

  // Hold on a neutral splash until the persisted session is restored, so we
  // never flash the sign-in screen at an already-authenticated user.
  if (loading) {
    return (
      <View
        style={{
          flex: 1,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: colors.background,
        }}
      >
        <ActivityIndicator size="large" color={colors.accent} />
      </View>
    );
  }

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
        {/* patient/* screens are auto-registered with these root screenOptions
            (their navy headers are unchanged); the redirect guard above gates
            them. Groups are declared so Protected can prevent the tabs from
            mounting while signed out. */}
        <Stack.Protected guard={isSignedIn}>
          {/* The (drawer) group renders its own headers (drawer/tabs), so
              suppress the parent Stack header for it. */}
          <Stack.Screen name="(drawer)" options={{ headerShown: false }} />
        </Stack.Protected>

        <Stack.Protected guard={!isSignedIn}>
          <Stack.Screen name="(auth)" options={{ headerShown: false }} />
        </Stack.Protected>
      </Stack>
    </>
  );
}

export default function RootLayout() {
  // One cold-start sweep of abandoned cache temps, off the critical path.
  useEffect(() => {
    const task = InteractionManager.runAfterInteractions(() => {
      void sweepTempFilesAsync();
    });
    return () => task.cancel();
  }, []);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <AuthProvider>
          <SettingsProvider>
            <SyncProvider>
              <RootNavigator />
            </SyncProvider>
          </SettingsProvider>
        </AuthProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
