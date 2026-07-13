import { Pressable, ScrollView, Text, View } from "react-native";

import { IMMERSIVE, OverlayChip } from "../../components/ImmersiveControls";
import { ASPECT_PRESETS } from "./cropGeometry";

type Props = {
  aspect: number | null;
  onAspectChange: (aspect: number | null) => void;
  onReset: () => void;
  resetDisabled: boolean;
  onDiscard: () => void;
  onSave: () => void;
  saveDisabled: boolean;
  disabled: boolean;
};

/** Bottom-bar contents while cropping: aspect presets, Reset, Discard / Save. */
export function CropToolbar({
  aspect,
  onAspectChange,
  onReset,
  resetDisabled,
  onDiscard,
  onSave,
  saveDisabled,
  disabled,
}: Props) {
  return (
    <View className="px-4 pb-4 pt-4">
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ gap: 8 }}
      >
        {ASPECT_PRESETS.map((preset) => (
          <OverlayChip
            key={preset.label}
            label={preset.label}
            active={aspect === preset.value}
            disabled={disabled}
            onPress={() => onAspectChange(preset.value)}
          />
        ))}
        <OverlayChip label="Reset" disabled={disabled || resetDisabled} onPress={onReset} />
      </ScrollView>

      <View className="mt-4 flex-row" style={{ gap: 10 }}>
        <Pressable
          disabled={disabled}
          onPress={onDiscard}
          accessibilityLabel="Discard crop"
          className="flex-1 items-center rounded-xl py-3"
          style={{
            borderWidth: 1,
            borderColor: IMMERSIVE.controlBorder,
            opacity: disabled ? 0.5 : 1,
          }}
        >
          <Text className="text-sm font-semibold text-slate-200">Discard</Text>
        </Pressable>

        <Pressable
          disabled={disabled || saveDisabled}
          onPress={onSave}
          accessibilityLabel="Save crop"
          className="flex-1 items-center rounded-xl py-3"
          style={{
            backgroundColor: IMMERSIVE.active,
            opacity: disabled || saveDisabled ? 0.5 : 1,
          }}
        >
          <Text className="text-sm font-semibold" style={{ color: IMMERSIVE.onActive }}>
            Save
          </Text>
        </Pressable>
      </View>
    </View>
  );
}
