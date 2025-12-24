import { Stack } from "expo-router";
import "../services/nativewindInterop";
import "./global.css";

export default function RootLayout() {
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: "#0f172a" },
        headerTintColor: "white",
        headerTitleStyle: { fontWeight: "600" },
        contentStyle: { backgroundColor: "#f8fafc" },
      }}
    />
  );
}
