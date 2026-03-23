import { Stack } from "expo-router";
import { SafeAreaProvider } from "react-native-safe-area-context";
import "../services/nativewindInterop";
import "./global.css";

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: "#0f172a" },
          headerTintColor: "white",
          headerTitleStyle: { fontWeight: "600" },
          contentStyle: { backgroundColor: "#f8fafc" },
        }}
      />
    </SafeAreaProvider>
  );
}
