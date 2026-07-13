import { Feather } from "@expo/vector-icons";
import { ActivityIndicator, Pressable, Text, TextInput, View } from "react-native";

import { useThemeColors } from "../../hooks/useThemeColors";

type Props = {
  label: string;
  value: string;
  onChangeText: (text: string) => void;
  error: string | null;
  onGenerate: () => void;
  generating: boolean;
  maxLength: number;
  placeholder?: string;
  helper?: string;
  generateAccessibilityLabel: string;
};

/**
 * Identifier input with an inline Generate button — the EMR field on the add-patient
 * form and the consultation-ID field on the add-consultation form. The value is held
 * and shown exactly as typed (identifiers may contain any folder-safe characters);
 * error/border colors are inline `style` per the css-interop constraint.
 */
export function IdFieldWithGenerate({
  label,
  value,
  onChangeText,
  error,
  onGenerate,
  generating,
  maxLength,
  placeholder = "Required",
  helper,
  generateAccessibilityLabel,
}: Props) {
  const colors = useThemeColors();

  return (
    <View className="mb-4">
      <Text className="text-sm text-slate-600 mb-1 dark:text-slate-400">{label}</Text>
      <View
        className="flex-row items-center bg-white rounded-xl border dark:bg-slate-900"
        style={{ borderColor: error ? colors.danger : colors.border }}
      >
        <TextInput
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={colors.placeholder}
          autoCapitalize="none"
          autoCorrect={false}
          maxLength={maxLength}
          className="flex-1 px-3 py-2 text-base text-slate-900 dark:text-slate-100"
        />
        <Pressable
          onPress={onGenerate}
          disabled={generating}
          accessibilityLabel={generateAccessibilityLabel}
          className="px-3 py-2"
        >
          {generating ? (
            <ActivityIndicator size="small" color={colors.iconStrong} />
          ) : (
            <View className="flex-row items-center">
              <Feather name="refresh-cw" size={14} color={colors.iconStrong} />
              <Text className="ml-1 text-sm font-semibold text-slate-800 dark:text-slate-200">
                Generate
              </Text>
            </View>
          )}
        </Pressable>
      </View>
      {error ? (
        <Text className="mt-1 text-xs" style={{ color: colors.danger }}>
          {error}
        </Text>
      ) : helper ? (
        <Text className="mt-1 text-xs text-slate-400 dark:text-slate-500">{helper}</Text>
      ) : null}
    </View>
  );
}
