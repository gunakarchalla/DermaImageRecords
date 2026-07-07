import { Feather } from "@expo/vector-icons";
import { Drawer } from "expo-router/drawer";

import { useThemeColors } from "../../hooks/useThemeColors";

export default function DrawerLayout() {
  const colors = useThemeColors();

  return (
    <Drawer
      screenOptions={{
        headerStyle: { backgroundColor: colors.headerBackground },
        headerTintColor: colors.headerTint,
        headerTitleStyle: { fontWeight: "600" },
        sceneStyle: { backgroundColor: colors.background },
        drawerStyle: { backgroundColor: colors.drawerBackground },
        drawerActiveTintColor: colors.drawerActiveTint,
        drawerInactiveTintColor: colors.drawerInactiveTint,
        drawerActiveBackgroundColor: colors.drawerActiveBackground,
      }}
    >
      <Drawer.Screen
        name="index"
        options={{
          title: "Patients",
          drawerLabel: "Home",
          drawerIcon: ({ color, size }) => (
            <Feather name="home" size={size} color={color} />
          ),
        }}
      />
      <Drawer.Screen
        name="settings"
        options={{
          title: "Settings",
          drawerIcon: ({ color, size }) => (
            <Feather name="settings" size={size} color={color} />
          ),
        }}
      />
      <Drawer.Screen
        name="account"
        options={{
          title: "Account",
          drawerIcon: ({ color, size }) => (
            <Feather name="user" size={size} color={color} />
          ),
        }}
      />
      <Drawer.Screen
        name="import-export"
        options={{
          title: "Import / Export",
          drawerIcon: ({ color, size }) => (
            <Feather name="repeat" size={size} color={color} />
          ),
        }}
      />
      <Drawer.Screen
        name="info"
        options={{
          title: "Info",
          // The nested Stack in app/(drawer)/info renders its own headers
          // (menu + back buttons), so suppress the drawer's header here.
          headerShown: false,
          drawerIcon: ({ color, size }) => (
            <Feather name="info" size={size} color={color} />
          ),
        }}
      />
    </Drawer>
  );
}
