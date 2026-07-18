import { Feather } from "@expo/vector-icons";
import Slider from "@react-native-community/slider";
import * as LocalAuthentication from "expo-local-authentication";
import { useFocusEffect } from "expo-router";
import { useColorScheme } from "nativewind";
import { useCallback, useState } from "react";
import { ActivityIndicator, Alert, Pressable, ScrollView, Switch, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { ChipRow } from "../../components/ui/ChipRow";
import { Section } from "../../components/ui/Section";
import { SegmentedControl } from "../../components/ui/SegmentedControl";
import {
  FONT_SCALE_STEPS,
  IMAGE_FORMAT_KEYS,
  IMAGE_FORMATS,
  IMAGE_PRESETS,
  IMAGE_QUALITY_RANGE,
  MAX_DIMENSION_OPTIONS,
  describeImageSettings,
} from "../../constants/preferences";
import { useThemeColors } from "../../hooks/useThemeColors";
import { canUseAppLockAsync } from "../../services/lock/LockGate";
import { useSettings } from "../../services/preferences/SettingsProvider";
import {
  changeStorageFolderAsync,
  getCurrentStorageRootUriAsync,
  prettyStoragePath,
  supportsFolderSelection,
} from "../../services/storage/storageLocation";
import { wipeDeviceOnlyAsync, wipeEverywhereAsync } from "../../services/sync/wipe";

const IMAGE_FORMAT_OPTIONS = IMAGE_FORMAT_KEYS.map((format) => ({
  value: format,
  label: IMAGE_FORMATS[format].label,
}));

// PresetRow keeps `className` static and drives its selected-state colors through inline
// `style`. Toggling a NativeWind class post-render trips css-interop's View→Pressable
// upgrade path, which surfaces as a bogus navigation-context crash.

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
    appLock,
    setAppLock,
  } = useSettings();

  const onToggleAppLock = useCallback(
    async (next: boolean) => {
      if (!next) {
        setAppLock(false);
        return;
      }
      // Never enable a lock the user can't open: the device must have some security
      // enrolled, and the user must pass it once right now.
      if (!(await canUseAppLockAsync())) {
        Alert.alert(
          "No screen lock set up",
          "Set up a fingerprint, face unlock, or PIN in your device settings first.",
        );
        return;
      }
      const result = await LocalAuthentication.authenticateAsync({
        promptMessage: "Confirm to enable app lock",
      });
      if (result.success) setAppLock(true);
    },
    [setAppLock],
  );

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

  const runWipe = useCallback(async (everywhere: boolean) => {
    setWiping(true);
    try {
      if (everywhere) {
        await wipeEverywhereAsync();
      } else {
        await wipeDeviceOnlyAsync();
      }
      setRootUri(null);
      Alert.alert(
        "Data wiped",
        everywhere
          ? "All records were deleted here and in your Google Drive. Other synced devices will remove them on their next sync."
          : "All records on this device were deleted. Your Google Drive and other devices were not touched.",
      );
    } catch (error) {
      Alert.alert("Wipe failed", (error as Error).message);
    } finally {
      setWiping(false);
    }
  }, []);

  const onWipeData = useCallback(() => {
    Alert.alert(
      "Wipe all data?",
      "This permanently deletes every patient and consultation, including photos. Choose how far the wipe should go.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "This device only",
          style: "destructive",
          onPress: () => void runWipe(false),
        },
        {
          text: "Everywhere",
          style: "destructive",
          onPress: () => {
            // A second, scarier confirmation: this reaches Drive and every synced device.
            Alert.alert(
              "Wipe everywhere?",
              "This also deletes the records from your Google Drive, and every synced device will remove them on its next sync. This cannot be undone.",
              [
                { text: "Cancel", style: "cancel" },
                {
                  text: "Wipe everywhere",
                  style: "destructive",
                  onPress: () => void runWipe(true),
                },
              ],
            );
          },
        },
      ],
    );
  }, [runWipe]);

  return (
    <SafeAreaView edges={["bottom", "left", "right"]} className="flex-1 bg-slate-50 dark:bg-slate-950">
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 48 }}>
        {/* 1. Theme */}
        <Section
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
        </Section>

        {/* 2. Font Size */}
        <Section
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
        </Section>

        {/* 3. Image Storage */}
        <Section
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
                <SegmentedControl
                  options={IMAGE_FORMAT_OPTIONS}
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
                <ChipRow
                  options={MAX_DIMENSION_OPTIONS}
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
        </Section>

        {/* 4. App lock */}
        <Section
          icon="lock"
          title="App lock"
          subtitle="Require your fingerprint, face, or device PIN when opening the app."
        >
          <View className="flex-row items-center justify-between">
            <Text className="text-base font-medium text-slate-900 dark:text-slate-100">
              {appLock ? "On" : "Off"}
            </Text>
            <Switch
              value={appLock}
              onValueChange={(next) => void onToggleAppLock(next)}
              trackColor={{ false: "#cbd5e1", true: "#475569" }}
              thumbColor={appLock ? "#e2e8f0" : "#f8fafc"}
              ios_backgroundColor="#cbd5e1"
            />
          </View>
          <Text className="mt-2 text-xs text-slate-400 dark:text-slate-500">
            Also locks when you come back after more than 30 seconds away.
          </Text>
        </Section>

        {/* 5. Change Folder */}
        <Section
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
        </Section>

        {/* 6. Wipe Data */}
        <Section
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
        </Section>
      </ScrollView>
    </SafeAreaView>
  );
}
