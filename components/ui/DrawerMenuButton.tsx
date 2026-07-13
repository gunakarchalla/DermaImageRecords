import { Feather } from "@expo/vector-icons";
import { DrawerActions, useNavigation } from "@react-navigation/native";
import { Pressable } from "react-native";

/**
 * Hamburger button for headers rendered by navigators nested inside the drawer (the Home
 * tabs, the Info stack). `DrawerActions.openDrawer` bubbles up to the drawer navigator,
 * so this works from any depth.
 */
export function DrawerMenuButton({ tint }: { tint: string }) {
  const navigation = useNavigation();

  return (
    <Pressable
      onPress={() => navigation.dispatch(DrawerActions.openDrawer())}
      accessibilityLabel="Open menu"
      accessibilityRole="button"
      style={{ paddingLeft: 16, paddingRight: 8 }}
    >
      <Feather name="menu" size={22} color={tint} />
    </Pressable>
  );
}
