import { Feather } from "@expo/vector-icons";
import { Pressable, Text, View } from "react-native";

import { useThemeColors } from "../hooks/useThemeColors";

type DictationButtonProps = {
  isListening: boolean;
  onPress: () => void;
  disabled?: boolean;
};

/**
 * Mic toggle for a dictated text field.
 *
 * The active/idle colours are driven through inline `style` rather than a
 * swapped `className`: toggling NativeWind classes that carry a shadow or
 * interaction style after first render trips css-interop and surfaces as a
 * bogus "navigation context" crash.
 */
export const DictationButton = ({
  isListening,
  onPress,
  disabled = false,
}: DictationButtonProps) => {
  const colors = useThemeColors();

  const backgroundColor = isListening ? colors.danger : "transparent";
  const borderColor = isListening ? colors.danger : colors.border;
  const contentColor = isListening ? "#ffffff" : colors.icon;

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={isListening ? "Stop dictation" : "Dictate remarks"}
      accessibilityState={{ disabled, selected: isListening }}
      className={`flex-row items-center rounded-lg border px-3 py-1.5 ${
        disabled ? "opacity-50" : ""
      }`}
      style={{ backgroundColor, borderColor }}
    >
      <Feather
        name={isListening ? "square" : "mic"}
        size={14}
        color={contentColor}
      />
      <Text
        className="ml-1.5 text-xs font-semibold"
        style={{ color: contentColor }}
      >
        {isListening ? "Stop" : "Dictate"}
      </Text>
    </Pressable>
  );
};

type DictationStatusProps = {
  isListening: boolean;
  interim: string;
  error: string | null;
};

/**
 * Live feedback under the field. Interim speech is shown here rather than
 * written into the input, so nothing lands in the record until the recogniser
 * has finalised it.
 */
export const DictationStatus = ({
  isListening,
  interim,
  error,
}: DictationStatusProps) => {
  if (error) {
    return (
      <Text className="mt-2 text-xs text-rose-600 dark:text-rose-400">
        {error}
      </Text>
    );
  }

  if (!isListening) return null;

  return (
    <View className="mt-2 flex-row items-start">
      <View className="mt-1 h-2 w-2 rounded-full bg-rose-500" />
      <Text className="ml-2 flex-1 text-xs italic text-slate-500 dark:text-slate-400">
        {interim || "Listening…"}
      </Text>
    </View>
  );
};
