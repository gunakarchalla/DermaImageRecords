import { Feather } from "@expo/vector-icons";
import { Drawer } from "expo-router/drawer";
import type { ComponentProps } from "react";

import { useThemeColors } from "../../hooks/useThemeColors";

type FeatherName = ComponentProps<typeof Feather>["name"];

const drawerIcon = (name: FeatherName) => {
  const DrawerIcon = ({ color, size }: { color: string; size: number }) => (
    <Feather name={name} size={size} color={color} />
  );
  DrawerIcon.displayName = `DrawerIcon(${name})`;
  return DrawerIcon;
};

export default function DrawerLayout() {
  const colors = useThemeColors();

  return (
    <Drawer
      screenOptions={{
        headerStyle: { backgroundColor: colors.headerBackground },
        headerTintColor: colors.headerTint,
        headerTitleStyle: { fontWeight: "600" },
        sceneStyle: { backgroundColor: colors.background },
        drawerStyle: { backgroundColor: colors.background },
        drawerActiveTintColor: colors.tabBarActiveTint,
        drawerInactiveTintColor: colors.tabBarInactiveTint,
      }}
    >
      {/* The Home tabs render their own per-tab headers (with a hamburger). */}
      <Drawer.Screen
        name="(tabs)"
        options={{
          title: "Home",
          headerShown: false,
          drawerIcon: drawerIcon("home"),
        }}
      />
      <Drawer.Screen
        name="backup-sync"
        options={{
          title: "Backup & Sync",
          drawerIcon: drawerIcon("refresh-cw"),
        }}
      />
      <Drawer.Screen
        name="settings"
        options={{ title: "Settings", drawerIcon: drawerIcon("settings") }}
      />
      <Drawer.Screen
        name="account"
        options={{ title: "Account", drawerIcon: drawerIcon("user") }}
      />
      {/* The Info stack renders its own headers (back buttons on pushed screens). */}
      <Drawer.Screen
        name="info"
        options={{
          title: "Info",
          headerShown: false,
          drawerIcon: drawerIcon("info"),
        }}
      />
    </Drawer>
  );
}
