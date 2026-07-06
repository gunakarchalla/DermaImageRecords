import { Feather } from "@expo/vector-icons";
import { Drawer } from "expo-router/drawer";

export default function DrawerLayout() {
  return (
    <Drawer
      screenOptions={{
        headerStyle: { backgroundColor: "#0f172a" },
        headerTintColor: "white",
        headerTitleStyle: { fontWeight: "600" },
        drawerActiveTintColor: "#0f172a",
        drawerInactiveTintColor: "#475569",
        drawerActiveBackgroundColor: "#e2e8f0",
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
        name="about"
        options={{
          title: "About",
          drawerIcon: ({ color, size }) => (
            <Feather name="info" size={size} color={color} />
          ),
        }}
      />
    </Drawer>
  );
}
