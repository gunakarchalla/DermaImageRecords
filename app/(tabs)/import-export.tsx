import { Feather } from "@expo/vector-icons";
import Slider from "@react-native-community/slider";
import { useColorScheme } from "nativewind";
import type { ComponentProps, ReactNode } from "react";
import { useCallback, useState } from "react";
import { ActivityIndicator, Alert, Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import {
  BACKUP,
  BACKUP_PERIOD_PRESETS,
  periodLabel,
  type BackupMode,
  type BackupPeriodKey,
} from "../../constants/backup";
import { useThemeColors } from "../../hooks/useThemeColors";
import { useBackup } from "../../services/backup/BackupProvider";
import {
  type BackupProgress,
  exportDatasetAsync,
  importDatasetAsync,
} from "../../services/backup/backupService";

type FeatherName = ComponentProps<typeof Feather>["name"];

function Section({
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

const progressLabel = (progress: BackupProgress | null): string => {
  if (!progress) return "Working…";
  switch (progress.phase) {
    case "scanning":
      return "Scanning records…";
    case "archiving":
      return progress.total ? `Archiving ${progress.current} of ${progress.total}…` : "Archiving…";
    case "uploading":
      return "Uploading to Google Drive…";
    case "reading":
      return "Reading file…";
    case "extracting":
      return progress.total ? `Importing ${progress.current} of ${progress.total}…` : "Importing…";
    case "indexing":
      return "Rebuilding index…";
    default:
      return "Working…";
  }
};

const MODE_OPTIONS: { value: BackupMode; label: string }[] = [
  { value: "off", label: "Off" },
  { value: "manual", label: "Manual" },
  { value: "automatic", label: "Automatic" },
];

const formatLastBackup = (ts: number | null): string => {
  if (!ts) return "Never backed up";
  const date = new Date(ts);
  return `Last backup: ${date.toLocaleDateString()} ${date.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  })}`;
};

/** Reassure the user that a failed automatic backup is coming back on its own. */
const formatNextRetry = (ts: number | null): string | null => {
  if (!ts) return null;
  if (Date.now() >= ts) return "Retrying shortly…";
  const time = new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return `Will retry automatically around ${time}.`;
};

// The active/inactive styling below is applied via inline `style`, not by toggling
// Tailwind classes. Dynamically adding/removing a shadow or interaction class on a
// css-interop component after its first render trips its "View → Pressable" upgrade
// path, which then crashes serializing props. Keeping `className` static (only the
// non-changing `text-*` classes remain, so global font scaling still applies) avoids
// that entirely. Palette values mirror the hardcoded slate theme (see useThemeColors).

/** Segmented Off / Manual / Automatic selector. */
function ModeSelector({
  value,
  onChange,
  disabled,
}: {
  value: BackupMode;
  onChange: (mode: BackupMode) => void;
  disabled: boolean;
}) {
  const { colorScheme } = useColorScheme();
  const isDark = colorScheme === "dark";
  const trackBg = isDark ? "#1e293b" : "#f1f5f9"; // slate-800 / slate-100
  const activeBg = isDark ? "#475569" : "#ffffff"; // slate-600 / white
  const activeText = isDark ? "#f1f5f9" : "#0f172a"; // slate-100 / slate-900
  const inactiveText = isDark ? "#94a3b8" : "#64748b"; // slate-400 / slate-500

  return (
    <View
      style={{
        flexDirection: "row",
        borderRadius: 8,
        padding: 4,
        backgroundColor: trackBg,
        opacity: disabled ? 0.5 : 1,
      }}
    >
      {MODE_OPTIONS.map((option) => {
        const active = option.value === value;
        return (
          <Pressable
            key={option.value}
            onPress={() => onChange(option.value)}
            disabled={disabled}
            style={{
              flex: 1,
              alignItems: "center",
              borderRadius: 6,
              paddingVertical: 8,
              backgroundColor: active ? activeBg : "transparent",
            }}
          >
            <Text className="text-sm font-semibold" style={{ color: active ? activeText : inactiveText }}>
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** Period preset chips (Daily / Weekly / Monthly / Custom). */
function PeriodChips({
  value,
  onChange,
  disabled,
}: {
  value: BackupPeriodKey;
  onChange: (key: BackupPeriodKey) => void;
  disabled: boolean;
}) {
  const { colorScheme } = useColorScheme();
  const isDark = colorScheme === "dark";
  const activeBg = isDark ? "#f1f5f9" : "#0f172a"; // slate-100 / slate-900
  const activeText = isDark ? "#0f172a" : "#ffffff";
  const inactiveBorder = isDark ? "#334155" : "#cbd5e1"; // slate-700 / slate-300
  const inactiveBg = isDark ? "#1e293b" : "#ffffff"; // slate-800 / white
  const inactiveText = isDark ? "#e2e8f0" : "#334155"; // slate-200 / slate-700

  const chips: { key: BackupPeriodKey; label: string }[] = [
    ...BACKUP_PERIOD_PRESETS.map((preset) => ({ key: preset.key, label: preset.label })),
    { key: "custom", label: "Custom" },
  ];

  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, opacity: disabled ? 0.5 : 1 }}>
      {chips.map((chip) => {
        const active = chip.key === value;
        return (
          <Pressable
            key={chip.key}
            onPress={() => onChange(chip.key)}
            disabled={disabled}
            style={{
              borderRadius: 999,
              borderWidth: 1,
              paddingHorizontal: 16,
              paddingVertical: 8,
              borderColor: active ? activeBg : inactiveBorder,
              backgroundColor: active ? activeBg : inactiveBg,
            }}
          >
            <Text className="text-sm font-medium" style={{ color: active ? activeText : inactiveText }}>
              {chip.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export default function ImportExportScreen() {
  const colors = useThemeColors();
  const { colorScheme } = useColorScheme();
  const isDark = colorScheme === "dark";
  const [busy, setBusy] = useState<null | "export" | "import">(null);
  const [progress, setProgress] = useState<BackupProgress | null>(null);

  const cloud = useBackup();
  const anyBusy = busy !== null || cloud.busy;
  // A pending retry outlives a switch away from automatic mode (so re-enabling resumes the
  // backoff), but only automatic mode actually runs it — don't promise a retry otherwise.
  const retryNotice =
    cloud.busy || cloud.mode !== "automatic" ? null : formatNextRetry(cloud.nextRetryAt);

  const onBackupNow = useCallback(async () => {
    try {
      await cloud.backupNow();
      Alert.alert("Backup complete", "Your records were backed up to Google Drive.");
    } catch (error) {
      Alert.alert("Backup failed", (error as Error).message);
    }
  }, [cloud]);

  const onExport = useCallback(async () => {
    setBusy("export");
    setProgress(null);
    try {
      await exportDatasetAsync(setProgress);
    } catch (error) {
      Alert.alert("Export failed", (error as Error).message);
    } finally {
      setBusy(null);
      setProgress(null);
    }
  }, []);

  const runImport = useCallback(async () => {
    setBusy("import");
    setProgress(null);
    try {
      const result = await importDatasetAsync(setProgress);
      if (result.cancelled) return;

      const lines = [`Imported ${result.imported} patient${result.imported === 1 ? "" : "s"}.`];
      if (result.skipped > 0) {
        lines.push(`Skipped ${result.skipped} already present.`);
      }
      if (result.invalid > 0) {
        lines.push(`${result.invalid} could not be read.`);
      }
      Alert.alert("Import complete", lines.join("\n"));
    } catch (error) {
      Alert.alert("Import failed", (error as Error).message);
    } finally {
      setBusy(null);
      setProgress(null);
    }
  }, []);

  const onImport = useCallback(() => {
    Alert.alert(
      "Import records",
      "Pick a .zip exported from this app. New patients are added to your existing records; patients that already exist are left unchanged.",
      [
        { text: "Cancel", style: "cancel" },
        { text: "Choose file", onPress: () => void runImport() },
      ],
    );
  }, [runImport]);

  return (
    <SafeAreaView edges={["bottom", "left", "right"]} className="flex-1 bg-slate-50 dark:bg-slate-950">
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 48 }}>
        {/* Cloud backup */}
        <Section
          icon="cloud"
          title="Cloud backup"
          subtitle="Back up all records to your Google Drive. Only this app can see the backup file, and each backup replaces the previous one."
        >
          <ModeSelector value={cloud.mode} onChange={cloud.setMode} disabled={anyBusy} />

          {cloud.mode === "automatic" ? (
            <View className="mt-4">
              <Text className="text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
                How often
              </Text>
              <View className="mt-2">
                <PeriodChips
                  value={cloud.periodKey}
                  onChange={cloud.setPeriodKey}
                  disabled={anyBusy}
                />
              </View>
              {cloud.periodKey === "custom" ? (
                <View className="mt-3">
                  <Text className="text-sm font-medium text-slate-700 dark:text-slate-200">
                    {cloud.customDays === 1 ? "Every day" : `Every ${cloud.customDays} days`}
                  </Text>
                  <Slider
                    style={{ marginTop: 4 }}
                    minimumValue={BACKUP.minCustomDays}
                    maximumValue={BACKUP.maxCustomDays}
                    step={1}
                    value={cloud.customDays}
                    onValueChange={cloud.setCustomDays}
                    disabled={anyBusy}
                    minimumTrackTintColor={colors.accent}
                    maximumTrackTintColor={colors.border}
                    thumbTintColor={colors.iconStrong}
                  />
                </View>
              ) : null}
              <Text className="mt-2 text-xs text-slate-400 dark:text-slate-500">
                Runs {periodLabel(cloud.periodKey, cloud.customDays).toLowerCase()} when you open
                the app, if a backup is due.
              </Text>
            </View>
          ) : null}

          {cloud.mode !== "off" ? (
            <>
              <Pressable
                onPress={onBackupNow}
                disabled={anyBusy}
                className={`mt-4 h-12 flex-row items-center justify-center rounded-lg bg-slate-900 dark:bg-slate-100 ${
                  anyBusy ? "opacity-50" : ""
                }`}
              >
                <Feather name="upload-cloud" size={18} color={isDark ? "#0f172a" : "#ffffff"} />
                <Text className="ml-2 text-base font-semibold text-white dark:text-slate-900">
                  Back up now
                </Text>
              </Pressable>
              <Text className="mt-2 text-xs text-slate-400 dark:text-slate-500">
                {formatLastBackup(cloud.lastBackupAt)}
              </Text>
              {cloud.lastError ? (
                <Text className="mt-1 text-xs text-rose-500 dark:text-rose-400">
                  Last attempt failed: {cloud.lastError}
                </Text>
              ) : null}
              {retryNotice ? (
                <Text className="mt-1 text-xs text-slate-400 dark:text-slate-500">
                  {retryNotice}
                </Text>
              ) : null}
            </>
          ) : null}
        </Section>

        {/* Export */}
        <Section
          icon="upload"
          title="Export"
          subtitle="Save all patients, consultations, and photos to a single .zip you can back up or move to another device."
        >
          <Pressable
            onPress={onExport}
            disabled={anyBusy}
            className={`h-12 flex-row items-center justify-center rounded-lg bg-slate-900 dark:bg-slate-100 ${
              anyBusy ? "opacity-50" : ""
            }`}
          >
            <Feather name="upload" size={18} color={isDark ? "#0f172a" : "#ffffff"} />
            <Text className="ml-2 text-base font-semibold text-white dark:text-slate-900">
              Export to .zip
            </Text>
          </Pressable>
        </Section>

        {/* Import */}
        <Section
          icon="download"
          title="Import"
          subtitle="Add patient records from a .zip exported by this app. Existing patients are never overwritten."
        >
          <Pressable
            onPress={onImport}
            disabled={anyBusy}
            className={`h-12 flex-row items-center justify-center rounded-lg border border-slate-300 bg-white dark:border-slate-700 dark:bg-slate-800 ${
              anyBusy ? "opacity-50" : ""
            }`}
          >
            <Feather name="download" size={18} color={colors.iconStrong} />
            <Text className="ml-2 text-base font-semibold text-slate-900 dark:text-slate-100">
              Import from .zip
            </Text>
          </Pressable>
        </Section>

        <View className="mt-1 flex-row items-start">
          <Feather name="info" size={14} color={colors.iconMuted} style={{ marginTop: 2 }} />
          <Text className="ml-2 flex-1 text-xs text-slate-400 dark:text-slate-500">
            Records are matched by their unique ID, so re-importing the same backup won&apos;t
            create duplicates.
          </Text>
        </View>
      </ScrollView>

      {anyBusy ? (
        <View className="absolute inset-0 items-center justify-center bg-black/40">
          <View className="min-w-[220px] items-center rounded-2xl bg-white px-8 py-6 dark:bg-slate-900">
            <ActivityIndicator size="large" color={colors.accent} />
            <Text className="mt-3 text-center text-base font-medium text-slate-900 dark:text-slate-100">
              {progressLabel(cloud.busy ? cloud.progress : progress)}
            </Text>
          </View>
        </View>
      ) : null}
    </SafeAreaView>
  );
}
