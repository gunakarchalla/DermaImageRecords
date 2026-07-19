import { GoogleSignin } from "@react-native-google-signin/google-signin";
import {
    createContext,
    useCallback,
    useContext,
    useEffect,
    useMemo,
    useRef,
    useState,
    type ReactNode,
} from "react";
import { AppState } from "react-native";

import { SYNC, syncRetryDelayMs } from "../../constants/sync";
import { subscribeDatasetRevision } from "../datasetRevision";
import { useAuth } from "../auth/AuthProvider";
import {
    DriveAccessError,
    ensureDriveAccessTokenAsync,
    getStorageQuotaAsync,
    type DriveQuota,
} from "./driveClient";
import { getLastSyncFinishedAt, isSyncRunning, runSyncAsync, SyncPreconditionError, type SyncSummary } from "./syncEngine";
import { syncDb, type SyncLogRow } from "./syncDb";

/**
 * Sync lifecycle + UI state. Triggers a sync on app foreground, after local edits
 * settle (debounced), periodically while active, and on demand; failed automatic runs
 * retry on an exponential backoff. Non-retryable Drive failures flip
 * `googleSessionState` to "needs-reauth" so screens show a persistent reconnect banner
 * instead of failing silently.
 */

export type SyncStatus = "off" | "idle" | "syncing" | "error" | "needs-reauth";

type SyncContextValue = {
    ready: boolean;
    enabled: boolean;
    setEnabled: (enabled: boolean) => void;
    status: SyncStatus;
    lastSyncAt: string | null;
    lastError: string | null;
    lastSummary: SyncSummary | null;
    syncNow: () => Promise<void>;
    reconnectGoogle: () => Promise<void>;
    report: SyncLogRow[];
    refreshReport: () => Promise<void>;
    clearReport: () => Promise<void>;
    quota: DriveQuota | null;
    refreshQuota: () => Promise<void>;
};

const SyncContext = createContext<SyncContextValue | null>(null);

export const useSync = (): SyncContextValue => {
    const value = useContext(SyncContext);
    if (!value) throw new Error("useSync must be used inside SyncProvider.");
    return value;
};

export function SyncProvider({ children }: { children: ReactNode }) {
    const { isSignedIn } = useAuth();

    const [ready, setReady] = useState(false);
    const [enabled, setEnabledState] = useState(false);
    const [status, setStatus] = useState<SyncStatus>("off");
    const [lastSyncAt, setLastSyncAt] = useState<string | null>(null);
    const [lastError, setLastError] = useState<string | null>(null);
    const [lastSummary, setLastSummary] = useState<SyncSummary | null>(null);
    const [report, setReport] = useState<SyncLogRow[]>([]);
    const [quota, setQuota] = useState<DriveQuota | null>(null);

    const enabledRef = useRef(enabled);
    const signedInRef = useRef(isSignedIn);
    const retryAttemptRef = useRef(0);
    const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(() => {
        enabledRef.current = enabled;
    }, [enabled]);
    useEffect(() => {
        signedInRef.current = isSignedIn;
    }, [isSignedIn]);

    // Restore persisted state.
    useEffect(() => {
        let cancelled = false;
        void (async () => {
            const [storedEnabled, storedLastSync] = await Promise.all([
                syncDb.getMetaAsync("syncEnabled"),
                syncDb.getMetaAsync("lastSyncAt"),
            ]);
            if (cancelled) return;
            const on = storedEnabled === "true";
            setEnabledState(on);
            setStatus(on ? "idle" : "off");
            setLastSyncAt(storedLastSync);
            setReady(true);
        })();
        return () => {
            cancelled = true;
        };
    }, []);

    const refreshReport = useCallback(async () => {
        setReport(await syncDb.readRecentLogAsync(30));
    }, []);

    const clearReport = useCallback(async () => {
        await syncDb.clearLogAsync();
        setReport([]);
    }, []);

    const refreshQuota = useCallback(async () => {
        try {
            const token = await ensureDriveAccessTokenAsync();
            setQuota(await getStorageQuotaAsync(token));
        } catch {
            setQuota(null);
        }
    }, []);

    const clearRetry = useCallback(() => {
        if (retryTimerRef.current) {
            clearTimeout(retryTimerRef.current);
            retryTimerRef.current = null;
        }
    }, []);

    const runRef = useRef<(auto: boolean) => Promise<void>>(async () => {});

    const scheduleRetry = useCallback(() => {
        retryAttemptRef.current += 1;
        if (retryAttemptRef.current > SYNC.maxRetryAttempts) return;
        clearRetry();
        retryTimerRef.current = setTimeout(() => {
            void runRef.current(true);
        }, syncRetryDelayMs(retryAttemptRef.current));
    }, [clearRetry]);

    const run = useCallback(
        async (auto: boolean) => {
            if (!enabledRef.current || !signedInRef.current) return;
            if (isSyncRunning()) return;

            setStatus("syncing");
            setLastError(null);
            try {
                const summary = await runSyncAsync();
                setLastSummary(summary);
                const now = new Date().toISOString();
                setLastSyncAt(now);

                if (summary.errors > 0) {
                    // The cycle finished, but some items didn't make it — say so and
                    // retry on the backoff instead of presenting a clean sync.
                    setLastError(
                        `${summary.errors} item${summary.errors === 1 ? "" : "s"} didn't sync — retrying automatically.`,
                    );
                    setStatus("error");
                    if (auto) scheduleRetry();
                } else {
                    retryAttemptRef.current = 0;
                    clearRetry();
                    setStatus("idle");
                }
                void refreshReport();
            } catch (error) {
                const message = (error as Error).message || "Sync failed.";
                setLastError(message);
                if (error instanceof DriveAccessError && !error.retryable) {
                    setStatus("needs-reauth");
                } else if (error instanceof SyncPreconditionError) {
                    setStatus("error");
                } else {
                    setStatus("error");
                    if (auto) scheduleRetry();
                }
                await syncDb.appendLogAsync("error", message);
                void refreshReport();
                if (!auto) throw error;
            }
        },
        [clearRetry, refreshReport, scheduleRetry],
    );

    useEffect(() => {
        runRef.current = run;
    }, [run]);

    const setEnabled = useCallback(
        (next: boolean) => {
            setEnabledState(next);
            setStatus(next ? "idle" : "off");
            void syncDb.setMetaAsync("syncEnabled", next ? "true" : "false");
            if (next) {
                void run(true);
            } else {
                clearRetry();
            }
        },
        [clearRetry, run],
    );

    const syncNow = useCallback(async () => {
        await run(false);
    }, [run]);

    const reconnectGoogle = useCallback(async () => {
        try {
            await GoogleSignin.signIn();
            setStatus(enabledRef.current ? "idle" : "off");
            setLastError(null);
            void run(true);
        } catch {
            // The user backed out; the banner stays.
        }
    }, [run]);

    // Trigger: app returns to the foreground.
    useEffect(() => {
        if (!ready) return;
        const subscription = AppState.addEventListener("change", (state) => {
            if (state === "active") void run(true);
        });
        // Once on startup too.
        void run(true);
        return () => subscription.remove();
    }, [ready, run]);

    // Trigger: local edits settle. Sync's own writes also bump the revision — ignore
    // bumps while a run is active or just finished, or every sync would beget another.
    useEffect(() => {
        if (!ready) return;
        const unsubscribe = subscribeDatasetRevision(() => {
            if (!enabledRef.current) return;
            if (isSyncRunning() || Date.now() - getLastSyncFinishedAt() < 3000) return;
            if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
            debounceTimerRef.current = setTimeout(() => {
                void run(true);
            }, SYNC.mutationDebounceMs);
        });
        return () => {
            unsubscribe();
            if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
        };
    }, [ready, run]);

    // Trigger: periodic while the app stays open.
    useEffect(() => {
        if (!ready) return;
        const interval = setInterval(() => {
            void run(true);
        }, SYNC.periodicIntervalMs);
        return () => clearInterval(interval);
    }, [ready, run]);

    useEffect(() => clearRetry, [clearRetry]);

    const value = useMemo<SyncContextValue>(
        () => ({
            ready,
            enabled,
            setEnabled,
            status,
            lastSyncAt,
            lastError,
            lastSummary,
            syncNow,
            reconnectGoogle,
            report,
            refreshReport,
            clearReport,
            quota,
            refreshQuota,
        }),
        [
            ready,
            enabled,
            setEnabled,
            status,
            lastSyncAt,
            lastError,
            lastSummary,
            syncNow,
            reconnectGoogle,
            report,
            refreshReport,
            clearReport,
            quota,
            refreshQuota,
        ],
    );

    return <SyncContext.Provider value={value}>{children}</SyncContext.Provider>;
}
