import { Feather } from "@expo/vector-icons";
import { Tabs } from "expo-router";

import { DrawerMenuButton } from "../../../components/ui/DrawerMenuButton";
import { useThemeColors } from "../../../hooks/useThemeColors";

export default function HomeTabsLayout() {
  const colors = useThemeColors();

  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: colors.headerBackground },
        headerTintColor: colors.headerTint,
        headerTitleStyle: { fontWeight: "600" },
        headerLeft: () => <DrawerMenuButton tint={colors.headerTint} />,
        sceneStyle: { backgroundColor: colors.background },
        tabBarStyle: {
          backgroundColor: colors.tabBarBackground,
          borderTopColor: colors.border,
        },
        tabBarActiveTintColor: colors.tabBarActiveTint,
        tabBarInactiveTintColor: colors.tabBarInactiveTint,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Patients",
          tabBarIcon: ({ color, size }) => (
            <Feather name="users" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="gallery"
        options={{
          title: "Gallery",
          tabBarIcon: ({ color, size }) => (
            <Feather name="image" size={size} color={color} />
          ),
        }}
      />
    </Tabs>
  );
}
