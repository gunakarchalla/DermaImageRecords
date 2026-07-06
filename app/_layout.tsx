import { Stack } from "expo-router";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import "../services/nativewindInterop";
import "./global.css";

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <Stack
          screenOptions={{
            headerStyle: { backgroundColor: "#0f172a" },
            headerTintColor: "white",
            headerTitleStyle: { fontWeight: "600" },
            contentStyle: { backgroundColor: "#f8fafc" },
          }}
        >
          {/* The (drawer) group renders its own header (with the menu
              button), so suppress the parent Stack header for it. */}
          <Stack.Screen name="(drawer)" options={{ headerShown: false }} />
        </Stack>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
