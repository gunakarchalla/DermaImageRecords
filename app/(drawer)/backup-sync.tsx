import { Feather } from "@expo/vector-icons";
import { useFocusEffect } from "expo-router";
import { useColorScheme } from "nativewind";
import { useCallback, useState } from "react";
import { ActivityIndicator, Alert, Pressable, ScrollView, Switch, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { ConflictReviewSheet } from "../../components/ConflictReviewSheet";
import { Section } from "../../components/ui/Section";
import { ExportSelectSheet, type SelectItem } from "../../features/export/ExportSelectSheet";
import { useThemeColors } from "../../hooks/useThemeColors";
import {
  describeBackupProgress,
  type BackupProgress,
} from "../../services/backup/progress";
import { exportDatasetAsync, type ExportFilter } from "../../services/backup/zipExport";
import { patientIndexService } from "../../services/indexing/patientIndexService";
import { formatEmrNumberForDisplay } from "../../services/patient/emr";
import {
  analyzeArchiveEntriesAsync,
  applyImportAsync,
  pickAndReadArchiveAsync,
  type ArchivePlanEntry,
  type ImportDecision,
  type ImportSummary,
} from "../../services/backup/zipImport";
import { useSync } from "../../services/sync/SyncProvider";
import type { SyncLogRow } from "../../services/sync/syncDb";

const summaryLines = (summary: ImportSummary): string[] => {
  const lines: string[] = [];
  if (summary.imported > 0) {
    lines.push(`Added ${summary.imported} new patient${summary.imported === 1 ? "" : "s"}.`);
  }
  if (summary.merged > 0) {
    lines.push(`Merged ${summary.merged} existing patient${summary.merged === 1 ? "" : "s"}.`);
  }
  if (summary.addedAsNew > 0) {
    lines.push(
      `Added ${summary.addedAsNew} under a new EMR${summary.addedAsNew === 1 ? "" : "s"}.`,
    );
  }
  if (summary.duplicateInArchive > 0) {
    lines.push(
      `Ignored ${summary.duplicateInArchive} repeated EMR number${
        summary.duplicateInArchive === 1 ? "" : "s"
      } in the file.`,
    );
  }
  if (summary.invalid > 0) {
    lines.push(`${summary.invalid} could not be read.`);
  }
  if (lines.length === 0) {
    lines.push("Everything was already up to date.");
  }
  return lines;
};

const formatBytes = (bytes: number): string => {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(0)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
};

const formatLastSync = (iso: string | null): string => {
  if (!iso) return "Never synced";
  const date = new Date(iso);
  return `Last sync: ${date.toLocaleDateString()} ${date.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  })}`;
};

/** "just now" / "12 min ago" / "3 h ago" / a date, for the sync report rows. */
const relativeTime = (iso: string): string => {
  const ms = Date.now() - Date.parse(iso);
  if (!Number.isFinite(ms) || ms < 0) return new Date(iso).toLocaleString();
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return new Date(iso).toLocaleDateString();
};

const LOG_ICONS: Record<SyncLogRow["level"], { icon: React.ComponentProps<typeof Feather>["name"]; tone: "muted" | "warn" | "error" }> = {
  info: { icon: "info", tone: "muted" },
  conflict: { icon: "git-merge", tone: "warn" },
  renamed: { icon: "edit-3", tone: "warn" },
  error: { icon: "alert-circle", tone: "error" },
};

export default function BackupSyncScreen() {
  const colors = useThemeColors();
  const { colorScheme } = useColorScheme();
  const isDark = colorScheme === "dark";
  const sync = useSync();

  const [busy, setBusy] = useState<null | "export" | "import">(null);
  const [progress, setProgress] = useState<BackupProgress | null>(null);
  const [review, setReview] = useState<{
    mismatches: ArchivePlanEntry[];
    resolve: (decisions: Record<string, ImportDecision> | null) => void;
  } | null>(null);

  const anyBusy = busy !== null || sync.status === "syncing";

  useFocusEffect(
    useCallback(() => {
      void sync.refreshReport();
      if (sync.enabled) void sync.refreshQuota();
      // Refresh-on-focus only; identities of these callbacks are stable.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [sync.enabled]),
  );

  const showReviewAsync = useCallback(
    (mismatches: ArchivePlanEntry[]): Promise<Record<string, ImportDecision> | null> =>
      new Promise((resolve) => setReview({ mismatches, resolve })),
    [],
  );

  const finishReview = useCallback(
    (decisions: Record<string, ImportDecision> | null) => {
      review?.resolve(decisions);
      setReview(null);
    },
    [review],
  );

  const onSyncNow = useCallback(async () => {
    try {
      await sync.syncNow();
    } catch (error) {
      Alert.alert("Sync failed", (error as Error).message);
    }
  }, [sync]);

  const [patientSheet, setPatientSheet] = useState<SelectItem[] | null>(null);

  const onExport = useCallback(async (filter?: ExportFilter) => {
    setBusy("export");
    setProgress(null);
    try {
      await exportDatasetAsync(setProgress, filter);
    } catch (error) {
      Alert.alert("Export failed", (error as Error).message);
    } finally {
      setBusy(null);
      setProgress(null);
    }
  }, []);

  const onPickPatientsToExport = useCallback(async () => {
    try {
      // Drain the paginated index into one selection list.
      const items: SelectItem[] = [];
      let cursor: Awaited<ReturnType<typeof patientIndexService.queryPatientsPageAsync>>["nextCursor"];
      do {
        const page = await patientIndexService.queryPatientsPageAsync({
          limit: 200,
          sortField: "name",
          sortDirection: "asc",
          cursor,
        });
        items.push(
          ...page.items.map((p) => ({
            key: p.id,
            label: p.name,
            sublabel: `EMR ${formatEmrNumberForDisplay(p.emrNumber)}`,
          })),
        );
        cursor = page.nextCursor;
      } while (cursor && items.length < 5000);

      if (items.length === 0) {
        Alert.alert("Nothing to export", "There are no patients yet.");
        return;
      }
      setPatientSheet(items);
    } catch (error) {
      Alert.alert("Couldn't load patients", (error as Error).message);
    }
  }, []);

  const onImport = useCallback(async () => {
    setBusy("import");
    setProgress(null);
    let staged: Awaited<ReturnType<typeof pickAndReadArchiveAsync>> = null;
    try {
      staged = await pickAndReadArchiveAsync(setProgress);
      if (!staged) return; // user cancelled the file picker

      const analysis = await analyzeArchiveEntriesAsync(staged);
      if (analysis.plan.length === 0) {
        Alert.alert(
          "Nothing to import",
          analysis.legacy > 0
            ? "This file was exported by an older version of the app and can't be imported."
            : "No patient records were found in this file.",
        );
        return;
      }

      const mismatches = analysis.plan.filter((p) => p.nameMismatch);
      const decisions = mismatches.length > 0 ? await showReviewAsync(mismatches) : {};
      if (decisions === null) return; // user cancelled the review

      const result = await applyImportAsync(staged, analysis, decisions, setProgress);
      Alert.alert("Import complete", summaryLines(result).join("\n"));
    } catch (error) {
      Alert.alert("Import failed", (error as Error).message);
    } finally {
      staged?.dispose();
      setBusy(null);
      setProgress(null);
    }
  }, [showReviewAsync]);

  const statusLine = (() => {
    switch (sync.status) {
      case "off":
        return "Sync is off.";
      case "syncing":
        return "Syncing…";
      case "needs-reauth":
        return "Google access needed.";
      case "error":
        return sync.lastError ?? "Last sync failed.";
      default:
        return formatLastSync(sync.lastSyncAt);
    }
  })();

  return (
    <SafeAreaView edges={["bottom", "left", "right"]} className="flex-1 bg-slate-50 dark:bg-slate-950">
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 48 }}>
        {/* Reconnect banner: sync can't reach Drive until the user re-consents. */}
        {sync.status === "needs-reauth" ? (
          <Pressable
            onPress={() => void sync.reconnectGoogle()}
            className="mb-4 flex-row items-center rounded-xl bg-amber-100 p-4 dark:bg-amber-900"
            accessibilityRole="button"
          >
            <Feather name="alert-triangle" size={20} color={isDark ? "#fbbf24" : "#b45309"} />
            <View className="ml-3 flex-1">
              <Text className="text-sm font-semibold text-amber-900 dark:text-amber-100">
                Reconnect Google to keep syncing
              </Text>
              <Text className="mt-0.5 text-xs text-amber-800 dark:text-amber-200">
                {sync.lastError ?? "Google Drive access was lost."} Tap to sign in again.
              </Text>
            </View>
          </Pressable>
        ) : null}

        {/* Sync */}
        <Section
          icon="refresh-cw"
          title="Sync with Google Drive"
          subtitle="Keeps this device and your other devices in step through a DermaImageRecords folder in your own Google Drive. Runs when you open the app and after you make changes."
        >
          <View className="flex-row items-center justify-between">
            <Text className="text-base font-medium text-slate-900 dark:text-slate-100">
              {sync.enabled ? "On" : "Off"}
            </Text>
            <Switch
              value={sync.enabled}
              onValueChange={sync.setEnabled}
              disabled={!sync.ready || busy !== null}
              trackColor={{ false: "#cbd5e1", true: "#475569" }}
              thumbColor={sync.enabled ? "#e2e8f0" : "#f8fafc"}
              ios_backgroundColor="#cbd5e1"
            />
          </View>

          {sync.enabled ? (
            <>
              <Pressable
                onPress={() => void onSyncNow()}
                disabled={anyBusy}
                className={`mt-4 h-12 flex-row items-center justify-center rounded-lg bg-slate-900 dark:bg-slate-100 ${
                  anyBusy ? "opacity-50" : ""
                }`}
              >
                {sync.status === "syncing" ? (
                  <ActivityIndicator size="small" color={isDark ? "#0f172a" : "#ffffff"} />
                ) : (
                  <>
                    <Feather name="refresh-cw" size={18} color={isDark ? "#0f172a" : "#ffffff"} />
                    <Text className="ml-2 text-base font-semibold text-white dark:text-slate-900">
                      Sync now
                    </Text>
                  </>
                )}
              </Pressable>

              <Text className="mt-2 text-xs text-slate-400 dark:text-slate-500">{statusLine}</Text>
              {sync.lastError && sync.status === "error" ? (
                <Text className="mt-1 text-xs text-rose-500 dark:text-rose-400">
                  {sync.lastError}
                </Text>
              ) : null}

              {sync.quota?.usedBytes != null ? (
                <Text className="mt-1 text-xs text-slate-400 dark:text-slate-500">
                  Google Drive: {formatBytes(sync.quota.usedBytes)} used
                  {sync.quota.limitBytes ? ` of ${formatBytes(sync.quota.limitBytes)}` : ""}.
                </Text>
              ) : null}
            </>
          ) : (
            <Text className="mt-3 text-xs text-slate-400 dark:text-slate-500">
              Turn on to mirror your records to a folder in your own Google Drive — nothing is
              stored on our servers. On a new device, turning sync on downloads everything.
            </Text>
          )}
        </Section>

        {/* Sync report */}
        {sync.enabled && sync.report.length > 0 ? (
          <Section
            icon="activity"
            title="Sync report"
            subtitle="What the last syncs merged, renamed, or healed."
          >
            {sync.report.map((row) => {
              const meta = LOG_ICONS[row.level];
              const tint =
                meta.tone === "error"
                  ? colors.danger
                  : meta.tone === "warn"
                    ? (isDark ? "#fbbf24" : "#b45309")
                    : colors.iconMuted;
              return (
                <View key={row.id} className="mb-3 flex-row items-start">
                  <Feather name={meta.icon} size={14} color={tint} style={{ marginTop: 2 }} />
                  <View className="ml-2 flex-1">
                    <Text className="text-xs text-slate-700 dark:text-slate-200">{row.message}</Text>
                    <Text className="mt-0.5 text-[10px] text-slate-400 dark:text-slate-500">
                      {relativeTime(row.at)}
                    </Text>
                  </View>
                </View>
              );
            })}
            <Pressable
              onPress={() => void sync.clearReport()}
              accessibilityRole="button"
              className="mt-1 flex-row items-center self-start py-1"
            >
              <Feather name="trash-2" size={13} color={colors.iconMuted} />
              <Text className="ml-1 text-xs font-semibold text-slate-500 dark:text-slate-400">
                Clear report
              </Text>
            </Pressable>
          </Section>
        ) : null}

        {/* Export */}
        <Section
          icon="upload"
          title="Export"
          subtitle="Save patients, consultations, and photos to a .zip — a point-in-time archive you control. Sync mirrors the current state; an export is a backup."
        >
          <Pressable
            onPress={() => void onExport()}
            disabled={anyBusy}
            className={`h-12 flex-row items-center justify-center rounded-lg bg-slate-900 dark:bg-slate-100 ${
              anyBusy ? "opacity-50" : ""
            }`}
          >
            <Feather name="upload" size={18} color={isDark ? "#0f172a" : "#ffffff"} />
            <Text className="ml-2 text-base font-semibold text-white dark:text-slate-900">
              Export everything
            </Text>
          </Pressable>
          <Pressable
            onPress={() => void onPickPatientsToExport()}
            disabled={anyBusy}
            className={`mt-3 h-12 flex-row items-center justify-center rounded-lg border border-slate-300 bg-white dark:border-slate-700 dark:bg-slate-800 ${
              anyBusy ? "opacity-50" : ""
            }`}
          >
            <Feather name="check-square" size={18} color={colors.iconStrong} />
            <Text className="ml-2 text-base font-semibold text-slate-900 dark:text-slate-100">
              Export selected patients…
            </Text>
          </Pressable>
        </Section>

        {/* Import */}
        <Section
          icon="download"
          title="Import"
          subtitle="Add patient records from a .zip exported by this app."
        >
          <Pressable
            onPress={() => void onImport()}
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
            Records are matched by their EMR number and a hidden identity, so re-importing or
            syncing the same records never creates duplicates.
          </Text>
        </View>
      </ScrollView>

      {busy !== null && !review ? (
        <View className="absolute inset-0 items-center justify-center bg-black/40">
          <View className="min-w-[220px] items-center rounded-2xl bg-white px-8 py-6 dark:bg-slate-900">
            <ActivityIndicator size="large" color={colors.accent} />
            <Text className="mt-3 text-center text-base font-medium text-slate-900 dark:text-slate-100">
              {describeBackupProgress(progress)}
            </Text>
          </View>
        </View>
      ) : null}

      {review ? (
        <ConflictReviewSheet mismatches={review.mismatches} onResolve={finishReview} />
      ) : null}

      {patientSheet ? (
        <ExportSelectSheet
          title="Export patients"
          subtitle="Choose the patients to include in the .zip."
          items={patientSheet}
          confirmLabel="Export"
          onCancel={() => setPatientSheet(null)}
          onConfirm={(keys) => {
            setPatientSheet(null);
            void onExport({ patientIds: new Set(keys) });
          }}
        />
      ) : null}
    </SafeAreaView>
  );
}
