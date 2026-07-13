import { Feather } from "@expo/vector-icons";
import { Image } from "expo-image";
import { Pressable, ScrollView, View } from "react-native";

import { IMMERSIVE } from "../../components/ImmersiveControls";

type Props = {
  uris: string[];
  onRemove: (uri: string) => void;
};

/** Strip of photos captured in this camera session, each removable before handoff. */
export function PendingTray({ uris, onRemove }: Props) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{
        paddingHorizontal: 16,
        paddingVertical: 10,
        gap: 10,
      }}
    >
      {uris.map((uri) => (
        <View key={uri}>
          <Image
            source={{ uri }}
            style={{ width: 56, height: 56, borderRadius: 12 }}
            contentFit="cover"
          />
          <Pressable
            onPress={() => onRemove(uri)}
            accessibilityLabel="Remove captured photo"
            hitSlop={8}
            className="absolute -right-1.5 -top-1.5 items-center justify-center rounded-full"
            style={{ width: 22, height: 22, backgroundColor: IMMERSIVE.active }}
          >
            <Feather name="x" size={12} color={IMMERSIVE.onActive} />
          </Pressable>
        </View>
      ))}
    </ScrollView>
  );
}
