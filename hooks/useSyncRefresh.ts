import { useCallback, useState } from "react";
import { Alert } from "react-native";

import { useSync } from "../services/sync/SyncProvider";

/**
 * Pull-to-refresh for the home lists (Patients, Gallery). A pull runs a full "Sync now"
 * against Google Drive when sync is on (the same action as the Backup & Sync button),
 * then reloads the on-screen list; when sync is off it just re-queries the local index.
 * Sync failures surface the same alert as that button — a pull is an explicit request for
 * the same work.
 *
 * `reload` should be the screen's first-page loader. Screens must gate their full-screen
 * loading spinner on `!refreshing` so the RefreshControl (not the centered spinner) shows
 * progress during a pull.
 */
export function useSyncRefresh(reload: () => Promise<void>) {
  const { enabled, syncNow } = useSync();
  const [refreshing, setRefreshing] = useState(false);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      if (enabled) await syncNow();
      await reload();
    } catch (error) {
      Alert.alert("Sync failed", (error as Error).message);
    } finally {
      setRefreshing(false);
    }
  }, [enabled, syncNow, reload]);

  return { refreshing, onRefresh };
}
