import { Feather } from "@expo/vector-icons";
import Slider from "@react-native-community/slider";
import { useFocusEffect } from "expo-router";
import type { ComponentProps, ReactNode } from "react";
import { useCallback, useState } from "react";
import { ActivityIndicator, Alert, Pressable, ScrollView, Switch, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { FONT_SCALE_STEPS } from "../../constants/preferences";
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

export default function SettingsScreen() {
  const colors = useThemeColors();
  const { theme, toggleTheme, fontStep, setFontStep } = useSettings();

  const [rootUri, setRootUri] = useState<string | null>(null);
  const [changingFolder, setChangingFolder] = useState(false);
  const [wiping, setWiping] = useState(false);

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

        {/* 3. Change Folder */}
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

        {/* 4. Wipe Data */}
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
