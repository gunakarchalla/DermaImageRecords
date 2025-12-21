import { Stack } from "expo-router";
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
