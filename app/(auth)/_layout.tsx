import { Stack } from "expo-router";

export default function AuthLayout() {
  // The sign-in screen renders its own full-bleed layout; no header.
  return <Stack screenOptions={{ headerShown: false }} />;
}
