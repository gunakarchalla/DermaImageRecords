import { Feather } from "@expo/vector-icons";
import Slider from "@react-native-community/slider";
import { Image } from "expo-image";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";

import { IMMERSIVE, OverlayIconButton } from "../../components/ImmersiveControls";

/** Live opacity control for the ghost overlay. Rendered in the tray, or on its own once the tray closes. */
export function GhostOpacityBar({
  value,
  onChange,
}: {
  value: number;
  onChange: (next: number) => void;
}) {
  return (
    <View className="px-4 pb-2 pt-1">
      <View className="mb-1 flex-row items-center justify-between">
        <Text className="text-xs font-medium" style={{ color: IMMERSIVE.icon }}>
          Ghost opacity
        </Text>
        <Text className="text-xs" style={{ color: IMMERSIVE.label }}>
          {Math.round(value * 100)}%
        </Text>
      </View>
      <Slider
        minimumValue={0}
        maximumValue={1}
        value={value}
        step={0.01}
        onValueChange={onChange}
        minimumTrackTintColor="#e2e8f0"
        maximumTrackTintColor="#334155"
        thumbTintColor="#e2e8f0"
      />
    </View>
  );
}

type Props = {
  ghostUris: string[];
  ghostPreviews: Record<string, string | undefined>;
  loading: boolean;
  failed: boolean;
  selectedUri: string | null;
  opacity: number;
  onSelect: (uri: string | null) => void;
  onOpacityChange: (next: number) => void;
  onClose: () => void;
};

/** "Align to a previous photo" tray: pick a prior photo to overlay on the viewfinder. */
export function GhostTray({
  ghostUris,
  ghostPreviews,
  loading,
  failed,
  selectedUri,
  opacity,
  onSelect,
  onOpacityChange,
  onClose,
}: Props) {
  return (
    <View className="pt-2">
      <View className="mb-3 flex-row items-center justify-between px-4">
        <View className="flex-1 pr-3">
          <Text className="text-sm font-semibold text-slate-100">
            Align to a previous photo
          </Text>
          <Text className="text-xs" style={{ color: IMMERSIVE.label }}>
            Overlay an earlier photo to reproduce the same framing.
          </Text>
        </View>
        <OverlayIconButton
          icon="chevron-down"
          accessibilityLabel="Close align tray"
          onPress={onClose}
        />
      </View>

      {loading ? (
        <View className="px-4 py-6">
          <ActivityIndicator color={IMMERSIVE.icon} />
        </View>
      ) : failed ? (
        <Text className="px-4 pb-4 text-sm" style={{ color: IMMERSIVE.label }}>
          Could not load previous consultation photos.
        </Text>
      ) : ghostUris.length === 0 ? (
        <Text className="px-4 pb-4 text-sm" style={{ color: IMMERSIVE.label }}>
          No earlier photos for this patient yet.
        </Text>
      ) : (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: 16, gap: 10 }}
        >
          <Pressable
            onPress={() => onSelect(null)}
            accessibilityLabel="No overlay"
            accessibilityState={{ selected: !selectedUri }}
            className="h-16 w-16 items-center justify-center rounded-2xl"
            style={{
              borderWidth: 2,
              borderColor: selectedUri ? IMMERSIVE.controlBorder : IMMERSIVE.active,
              backgroundColor: IMMERSIVE.control,
            }}
          >
            <Feather
              name="slash"
              size={16}
              color={selectedUri ? IMMERSIVE.label : IMMERSIVE.active}
            />
            <Text
              className="mt-0.5 text-xs font-medium"
              style={{ color: selectedUri ? IMMERSIVE.label : IMMERSIVE.active }}
            >
              None
            </Text>
          </Pressable>

          {ghostUris.map((uri) => {
            const selected = selectedUri === uri;
            return (
              <Pressable
                key={uri}
                onPress={() => onSelect(uri)}
                accessibilityLabel="Use this photo as an overlay"
                accessibilityState={{ selected }}
                className="h-16 w-16 overflow-hidden rounded-2xl"
                style={{
                  borderWidth: 2,
                  borderColor: selected ? IMMERSIVE.active : "transparent",
                }}
              >
                <Image
                  source={{ uri: ghostPreviews[uri] ?? uri }}
                  recyclingKey={uri}
                  cachePolicy="memory-disk"
                  style={{ flex: 1 }}
                  contentFit="cover"
                />
              </Pressable>
            );
          })}
        </ScrollView>
      )}

      {selectedUri ? <GhostOpacityBar value={opacity} onChange={onOpacityChange} /> : null}
    </View>
  );
}
