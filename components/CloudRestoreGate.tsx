import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Alert, Text, View } from "react-native";

import { useThemeColors } from "../hooks/useThemeColors";
import { useAuth } from "../services/auth/AuthProvider";
import { useBackup } from "../services/backup/BackupProvider";
import {
  describeBackupProgress,
  NoCloudBackupError,
  type RestoreResult,
} from "../services/backup/backupService";
import { hasAnyPatientsAsync } from "../services/storage";

/**
 * Offers to restore a Google Drive backup when a signed-in user has no records on this device.
 *
 * Renders nothing but an Alert (and a progress overlay while restoring), so it can sit next to
 * the root Stack without affecting layout. Two constraints shape the flow:
 *
 * 1. We cannot know whether a backup exists before asking. The `drive.file` scope is requested
 *    lazily (see services/backup/googleDrive.ts), so the prompt has to come first and consent
 *    second — hence "Restore" rather than "We found a backup".
 * 2. `hasAnyPatientsAsync` is the only safe emptiness check here: the ordinary storage helpers
 *    would open the SAF folder picker on a device that has never chosen one.
 *
 * The offer reappears on any sign-in while the dataset is still empty, so declining it by
 * accident — or clearing app data — is recoverable. Once records exist it never fires again;
 * from then on restore lives in the Import & export screen.
 */
export function CloudRestoreGate() {
  const colors = useThemeColors();
  const { isSignedIn } = useAuth();
  const { ready, progress, restoreFromCloud } = useBackup();

  const [restoring, setRestoring] = useState(false);
  // One offer per signed-in session; cleared on sign-out so the next account is checked afresh.
  const offeredRef = useRef(false);

  const runRestore = useCallback(async () => {
    setRestoring(true);
    try {
      // The dataset is empty, so no incoming patient can collide — every record is simply added.
      // (Name-mismatch review only applies when this device already holds records.)
      const result: RestoreResult = await restoreFromCloud();
      const backedUpOn = result.modifiedTime
        ? ` from the backup of ${new Date(result.modifiedTime).toLocaleDateString()}`
        : "";
      Alert.alert(
        "Restore complete",
        `Restored ${result.imported} patient${result.imported === 1 ? "" : "s"}${backedUpOn}.` +
          (result.invalid > 0 ? `\n${result.invalid} could not be read.` : ""),
      );
    } catch (error) {
      if (error instanceof NoCloudBackupError) {
        Alert.alert(
          "No backup found",
          "This Google account has no DermaImageRecords backup. You can start adding records now, and turn on cloud backup from Import & export.",
        );
        return;
      }
      Alert.alert("Restore failed", (error as Error).message);
    } finally {
      setRestoring(false);
    }
  }, [restoreFromCloud]);

  useEffect(() => {
    if (!isSignedIn) {
      offeredRef.current = false;
      return;
    }
    if (!ready || offeredRef.current) return;
    offeredRef.current = true;

    let cancelled = false;
    void (async () => {
      if (await hasAnyPatientsAsync()) return; // this device already holds records
      if (cancelled) return;

      Alert.alert(
        "Restore your records?",
        "If you backed up DermaImageRecords to Google Drive before, you can bring those patient records onto this device now. We'll ask for permission to read the backup file this app created.",
        [
          { text: "Start fresh", style: "cancel" },
          { text: "Restore", onPress: () => void runRestore() },
        ],
      );
    })();

    return () => {
      cancelled = true;
    };
  }, [isSignedIn, ready, runRestore]);

  if (!restoring) return null;

  return (
    <View className="absolute inset-0 items-center justify-center bg-black/40">
      <View className="min-w-[220px] items-center rounded-2xl bg-white px-8 py-6 dark:bg-slate-900">
        <ActivityIndicator size="large" color={colors.accent} />
        <Text className="mt-3 text-center text-base font-medium text-slate-900 dark:text-slate-100">
          {describeBackupProgress(progress)}
        </Text>
      </View>
    </View>
  );
}
