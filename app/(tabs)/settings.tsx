import { Feather } from "@expo/vector-icons";
import Slider from "@react-native-community/slider";
import { useFocusEffect } from "expo-router";
import { useColorScheme } from "nativewind";
import type { ComponentProps, ReactNode } from "react";
import { useCallback, useState } from "react";
import { ActivityIndicator, Alert, Pressable, ScrollView, Switch, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import {
  FONT_SCALE_STEPS,
  IMAGE_FORMAT_KEYS,
  IMAGE_FORMATS,
  IMAGE_PRESETS,
  IMAGE_QUALITY_RANGE,
  MAX_DIMENSION_OPTIONS,
  describeImageSettings,
  type ImageFormat,
  type MaxDimension,
} from "../../constants/preferences";
import { useThemeColors } from "../../hooks/useThemeColors";
import { useSettings } from "../../services/preferences/SettingsProvider";
import {
  changeStorageFolderAsync,
  getCurrentStorageRootUriAsync,
  prettyStoragePath,
  supportsFolderSelection,
  wipeAllDataAsync,
} from "../../services/storage/storageLocation";

type FeatherName = ComponentProps<typeof Feather>["name"];

function SettingsSection({
  icon,
  title,
  subtitle,
  children,
}: {
  icon: FeatherName;
  title: string;
  subtitle: string;
  children: ReactNode;
}) {
  const colors = useThemeColors();
  return (
    <View className="mb-5">
      <View className="mb-2 flex-row items-center">
        <Feather name={icon} size={16} color={colors.icon} />
        <Text className="ml-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
          {title}
        </Text>
      </View>
      <View className="rounded-xl bg-white p-4 shadow-sm dark:bg-slate-900">
        <Text className="text-sm text-slate-500 dark:text-slate-400">{subtitle}</Text>
        <View className="mt-3">{children}</View>
      </View>
    </View>
  );
}

// The three controls below keep `className` static and drive their selected-state colors
// through inline `style`. Toggling a NativeWind class post-render trips css-interop's
// View→Pressable upgrade path, which surfaces as a bogus navigation-context crash.

function PresetRow({
  label,
  hint,
  description,
  active,
  onPress,
}: {
  label: string;
  hint: string;
  description: string;
  active: boolean;
  onPress: () => void;
}) {
  const { colorScheme } = useColorScheme();
  const isDark = colorScheme === "dark";
  const selected = isDark ? "#e2e8f0" : "#0f172a"; // slate-200 / slate-900
  const idleBorder = isDark ? "#334155" : "#cbd5e1"; // slate-700 / slate-300
  const selectedBg = isDark ? "#1e293b" : "#f8fafc"; // slate-800 / slate-50
  const idleBg = isDark ? "#0f172a" : "#ffffff"; // slate-900 / white

  return (
    <Pressable
      onPress={onPress}
      style={{
        flexDirection: "row",
        alignItems: "flex-start",
        borderRadius: 12,
        borderWidth: 1,
        padding: 12,
        borderColor: active ? selected : idleBorder,
        backgroundColor: active ? selectedBg : idleBg,
      }}
    >
      <View
        style={{
          width: 18,
          height: 18,
          marginTop: 2,
          borderRadius: 9,
          borderWidth: 2,
          alignItems: "center",
          justifyContent: "center",
          borderColor: active ? selected : idleBorder,
        }}
      >
        {active ? (
          <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: selected }} />
        ) : null}
      </View>
      <View className="ml-3 flex-1">
        <View className="flex-row items-center justify-between">
          <Text className="text-base font-semibold text-slate-900 dark:text-slate-100">{label}</Text>
          <Text className="text-xs text-slate-400 dark:text-slate-500">{hint}</Text>
        </View>
        <Text className="mt-1 text-xs text-slate-500 dark:text-slate-400">{description}</Text>
      </View>
    </Pressable>
  );
}

function FormatSelector({
  value,
  onChange,
}: {
  value: ImageFormat;
  onChange: (format: ImageFormat) => void;
}) {
  const { colorScheme } = useColorScheme();
  const isDark = colorScheme === "dark";
  const trackBg = isDark ? "#1e293b" : "#f1f5f9"; // slate-800 / slate-100
  const activeBg = isDark ? "#475569" : "#ffffff"; // slate-600 / white
  const activeText = isDark ? "#f1f5f9" : "#0f172a"; // slate-100 / slate-900
  const inactiveText = isDark ? "#94a3b8" : "#64748b"; // slate-400 / slate-500

  return (
    <View style={{ flexDirection: "row", borderRadius: 8, padding: 4, backgroundColor: trackBg }}>
      {IMAGE_FORMAT_KEYS.map((format) => {
        const active = format === value;
        return (
          <Pressable
            key={format}
            onPress={() => onChange(format)}
            style={{
              flex: 1,
              alignItems: "center",
              borderRadius: 6,
              paddingVertical: 8,
              backgroundColor: active ? activeBg : "transparent",
            }}
          >
            <Text
              className="text-sm font-semibold"
              style={{ color: active ? activeText : inactiveText }}
            >
              {IMAGE_FORMATS[format].label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function ResolutionChips({
  value,
  onChange,
}: {
  value: MaxDimension;
  onChange: (maxDimension: MaxDimension) => void;
}) {
  const { colorScheme } = useColorScheme();
  const isDark = colorScheme === "dark";
  const activeBg = isDark ? "#f1f5f9" : "#0f172a"; // slate-100 / slate-900
  const activeText = isDark ? "#0f172a" : "#ffffff";
  const inactiveBorder = isDark ? "#334155" : "#cbd5e1"; // slate-700 / slate-300
  const inactiveBg = isDark ? "#1e293b" : "#ffffff"; // slate-800 / white
  const inactiveText = isDark ? "#e2e8f0" : "#334155"; // slate-200 / slate-700

  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
      {MAX_DIMENSION_OPTIONS.map((option) => {
        const active = option.value === value;
        return (
          <Pressable
            key={option.label}
            onPress={() => onChange(option.value)}
            style={{
              borderRadius: 999,
              borderWidth: 1,
              paddingHorizontal: 16,
              paddingVertical: 8,
              borderColor: active ? activeBg : inactiveBorder,
              backgroundColor: active ? activeBg : inactiveBg,
            }}
          >
            <Text
              className="text-sm font-medium"
              style={{ color: active ? activeText : inactiveText }}
            >
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export default function SettingsScreen() {
  const colors = useThemeColors();
  const {
    theme,
    toggleTheme,
    fontStep,
    setFontStep,
    imageSettings,
    imagePresetKey,
    setImageSettings,
    applyImagePreset,
  } = useSettings();

  const [rootUri, setRootUri] = useState<string | null>(null);
  const [changingFolder, setChangingFolder] = useState(false);
  const [wiping, setWiping] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);

  // Dragging the quality slider shouldn't rewrite the prefs file on every tick, so the
  // live value is held locally and only committed on release.
  const [qualityDraft, setQualityDraft] = useState<number | null>(null);

  const canSelectFolder = supportsFolderSelection();

  const refreshRoot = useCallback(async () => {
    try {
      setRootUri(await getCurrentStorageRootUriAsync());
    } catch {
      setRootUri(null);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void refreshRoot();
    }, [refreshRoot]),
  );

  const isDark = theme === "dark";
  const fontLabel = FONT_SCALE_STEPS[fontStep]?.label ?? "Default";

  const isLossless = IMAGE_FORMATS[imageSettings.format].lossless;
  const quality = qualityDraft ?? imageSettings.quality;

  const onChangeFolder = useCallback(async () => {
    if (!canSelectFolder) {
      Alert.alert(
        "Not available",
        "This platform stores data in a fixed app folder that can't be changed.",
      );
      return;
    }
    setChangingFolder(true);
    try {
      const newUri = await changeStorageFolderAsync();
      if (newUri) {
        setRootUri(newUri);
        Alert.alert(
          "Folder changed",
          "New records will be stored in the selected folder. Existing data in the previous folder was left untouched.",
        );
      }
    } catch (error) {
      Alert.alert("Couldn't change folder", (error as Error).message);
    } finally {
      setChangingFolder(false);
    }
  }, [canSelectFolder]);

  const onWipeData = useCallback(() => {
    Alert.alert(
      "Wipe all data?",
      "This permanently deletes every patient and consultation, including photos, and forgets the selected storage folder. This cannot be undone.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Wipe data",
          style: "destructive",
          onPress: async () => {
            setWiping(true);
            try {
              await wipeAllDataAsync();
              setRootUri(null);
              Alert.alert(
                "Data wiped",
                "All records have been deleted. You'll be asked to pick a storage folder next time you add data.",
              );
            } catch (error) {
              Alert.alert("Wipe failed", (error as Error).message);
            } finally {
              setWiping(false);
            }
          },
        },
      ],
    );
  }, []);

  return (
    <SafeAreaView edges={["bottom", "left", "right"]} className="flex-1 bg-slate-50 dark:bg-slate-950">
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 48 }}>
        {/* 1. Theme */}
        <SettingsSection
          icon="moon"
          title="Theme"
          subtitle="Switch between light and dark appearance."
        >
          <View className="flex-row items-center justify-between">
            <View className="flex-row items-center">
              <Feather
                name={isDark ? "moon" : "sun"}
                size={20}
                color={colors.iconStrong}
              />
              <Text className="ml-3 text-base font-medium text-slate-900 dark:text-slate-100">
                {isDark ? "Dark" : "Light"}
              </Text>
            </View>
            <Switch
              value={isDark}
              onValueChange={toggleTheme}
              trackColor={{ false: "#cbd5e1", true: "#475569" }}
              thumbColor={isDark ? "#e2e8f0" : "#f8fafc"}
              ios_backgroundColor="#cbd5e1"
            />
          </View>
        </SettingsSection>

        {/* 2. Font Size */}
        <SettingsSection
          icon="type"
          title="Font Size"
          subtitle="Scale the text size across the whole app."
        >
          <View className="flex-row items-center justify-between">
            <Text className="text-base font-medium text-slate-900 dark:text-slate-100">
              {fontLabel}
            </Text>
          </View>
          <View className="mt-1 flex-row items-center">
            <Text style={{ fontSize: 13 }} className="text-slate-400 dark:text-slate-500">
              A
            </Text>
            <Slider
              style={{ flex: 1, marginHorizontal: 8 }}
              minimumValue={0}
              maximumValue={FONT_SCALE_STEPS.length - 1}
              step={1}
              value={fontStep}
              onValueChange={setFontStep}
              minimumTrackTintColor={colors.accent}
              maximumTrackTintColor={colors.border}
              thumbTintColor={colors.iconStrong}
            />
            <Text style={{ fontSize: 24 }} className="text-slate-500 dark:text-slate-300">
              A
            </Text>
          </View>
          <View className="mt-3 rounded-lg bg-slate-50 p-3 dark:bg-slate-800">
            <Text className="text-base text-slate-700 dark:text-slate-200">
              The quick brown fox jumps over the lazy dog.
            </Text>
          </View>
        </SettingsSection>

        {/* 3. Image Storage */}
        <SettingsSection
          icon="image"
          title="Image Storage"
          subtitle="How new photos are encoded before they're saved. Photos already on disk are left as they are."
        >
          <View style={{ gap: 8 }}>
            {IMAGE_PRESETS.map((preset) => (
              <PresetRow
                key={preset.key}
                label={preset.label}
                hint={preset.hint}
                description={describeImageSettings(preset.settings)}
                active={preset.key === imagePresetKey}
                onPress={() => applyImagePreset(preset.key)}
              />
            ))}
            {imagePresetKey === null ? (
              <PresetRow
                label="Custom"
                hint="Your settings"
                description={describeImageSettings(imageSettings)}
                active
                onPress={() => setAdvancedOpen(true)}
              />
            ) : null}
          </View>

          <Pressable
            onPress={() => setAdvancedOpen((open) => !open)}
            className="mt-4 flex-row items-center"
          >
            <Feather
              name={advancedOpen ? "chevron-down" : "chevron-right"}
              size={16}
              color={colors.icon}
            />
            <Text className="ml-1 text-sm font-semibold text-slate-600 dark:text-slate-300">
              Advanced
            </Text>
          </Pressable>

          {advancedOpen ? (
            <View className="mt-3">
              <Text className="text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
                Format
              </Text>
              <View className="mt-2">
                <FormatSelector
                  value={imageSettings.format}
                  onChange={(format) => setImageSettings({ ...imageSettings, format })}
                />
              </View>

              <Text className="mt-4 text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
                Quality
              </Text>
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  marginTop: 4,
                  opacity: isLossless ? 0.5 : 1,
                }}
              >
                <Slider
                  style={{ flex: 1 }}
                  minimumValue={IMAGE_QUALITY_RANGE.min}
                  maximumValue={IMAGE_QUALITY_RANGE.max}
                  step={IMAGE_QUALITY_RANGE.step}
                  value={imageSettings.quality}
                  disabled={isLossless}
                  onValueChange={setQualityDraft}
                  onSlidingComplete={(next) => {
                    setQualityDraft(null);
                    setImageSettings({ ...imageSettings, quality: next });
                  }}
                  minimumTrackTintColor={colors.accent}
                  maximumTrackTintColor={colors.border}
                  thumbTintColor={colors.iconStrong}
                />
                <Text className="ml-3 w-12 text-right text-sm font-medium text-slate-700 dark:text-slate-200">
                  {Math.round(quality * 100)}%
                </Text>
              </View>
              {isLossless ? (
                <Text className="mt-1 text-xs text-slate-400 dark:text-slate-500">
                  {IMAGE_FORMATS[imageSettings.format].label} is lossless, so quality doesn&apos;t
                  apply. Expect much larger files.
                </Text>
              ) : null}

              <Text className="mt-4 text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
                Max resolution
              </Text>
              <View className="mt-2">
                <ResolutionChips
                  value={imageSettings.maxDimension}
                  onChange={(maxDimension) => setImageSettings({ ...imageSettings, maxDimension })}
                />
              </View>
              <Text className="mt-2 text-xs text-slate-400 dark:text-slate-500">
                Photos bigger than this are scaled down along their longest edge. Smaller photos are
                never enlarged.
              </Text>
            </View>
          ) : null}
        </SettingsSection>

        {/* 4. Change Folder */}
        <SettingsSection
          icon="folder"
          title="Change Folder"
          subtitle="Where patient & consultation data is stored on this device."
        >
          <View className="rounded-lg bg-slate-50 p-3 dark:bg-slate-800">
            <Text className="text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
              Current folder
            </Text>
            <Text className="mt-1 text-sm text-slate-700 dark:text-slate-200">
              {prettyStoragePath(rootUri)}
            </Text>
          </View>
          <Pressable
            onPress={onChangeFolder}
            disabled={changingFolder || !canSelectFolder}
            className={`mt-3 h-12 flex-row items-center justify-center rounded-lg bg-slate-900 dark:bg-slate-100 ${
              changingFolder || !canSelectFolder ? "opacity-50" : ""
            }`}
          >
            {changingFolder ? (
              <ActivityIndicator size="small" color={isDark ? "#0f172a" : "#ffffff"} />
            ) : (
              <>
                <Feather name="folder-plus" size={18} color={isDark ? "#0f172a" : "#ffffff"} />
                <Text className="ml-2 text-base font-semibold text-white dark:text-slate-900">
                  Pick another folder
                </Text>
              </>
            )}
          </Pressable>
          {!canSelectFolder ? (
            <Text className="mt-2 text-xs text-slate-400 dark:text-slate-500">
              Not available on this platform — data is kept in a fixed app folder.
            </Text>
          ) : null}
        </SettingsSection>

        {/* 5. Wipe Data */}
        <SettingsSection
          icon="trash-2"
          title="Wipe Data"
          subtitle="Permanently delete all patient & consultation data."
        >
          <Pressable
            onPress={onWipeData}
            disabled={wiping}
            className={`h-12 flex-row items-center justify-center rounded-lg bg-rose-600 dark:bg-rose-500 ${
              wiping ? "opacity-50" : ""
            }`}
          >
            {wiping ? (
              <ActivityIndicator size="small" color="#ffffff" />
            ) : (
              <>
                <Feather name="trash-2" size={18} color="#ffffff" />
                <Text className="ml-2 text-base font-semibold text-white">
                  Wipe all data
                </Text>
              </>
            )}
          </Pressable>
          <Text className="mt-2 text-xs text-slate-400 dark:text-slate-500">
            This cannot be undone.
          </Text>
        </SettingsSection>
      </ScrollView>
    </SafeAreaView>
  );
}
