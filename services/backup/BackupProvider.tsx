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
import { AppState, type AppStateStatus } from "react-native";

import {
    BACKUP,
    clampCustomDays,
    periodDays,
    retryDelayMs,
    type BackupMode,
    type BackupPeriodKey,
} from "../../constants/backup";
import { useAuth } from "../auth/AuthProvider";
import { backupToDriveAsync, isRetryableBackupError, type BackupProgress } from "./backupService";
import {
    DEFAULT_BACKUP_SETTINGS,
    readBackupSettingsAsync,
    writeBackupSettingsAsync,
    type StoredBackupSettings,
} from "./backupSettingsStore";

type BackupContextValue = {
    /** True once persisted settings have been loaded. */
    ready: boolean;
    mode: BackupMode;
    periodKey: BackupPeriodKey;
    customDays: number;
    /** Epoch ms of the last successful backup, or null. */
    lastBackupAt: number | null;
    /** A backup (manual or automatic) is currently running. */
    busy: boolean;
    progress: BackupProgress | null;
    /** Message from the last failed backup, cleared when a new one starts. */
    lastError: string | null;
    /** Epoch ms at which a failed automatic backup will be retried, or null when none is pending. */
    nextRetryAt: number | null;
    setMode: (mode: BackupMode) => void;
    setPeriodKey: (periodKey: BackupPeriodKey) => void;
    setCustomDays: (customDays: number) => void;
    /** Run a backup immediately. Rejects on failure so the caller can surface it. */
    backupNow: () => Promise<void>;
};

const BackupContext = createContext<BackupContextValue | null>(null);

const DAY_MS = 24 * 60 * 60 * 1000;

export function BackupProvider({ children }: { children: ReactNode }) {
    const { isSignedIn } = useAuth();

    const [ready, setReady] = useState(false);
    const [settings, setSettings] = useState<StoredBackupSettings>(DEFAULT_BACKUP_SETTINGS);
    const [busy, setBusy] = useState(false);
    const [progress, setProgress] = useState<BackupProgress | null>(null);
    const [lastError, setLastError] = useState<string | null>(null);

    // Latest values for the AppState listener (registered once) to read without going stale.
    const settingsRef = useRef(settings);
    settingsRef.current = settings;
    const signedInRef = useRef(isSignedIn);
    signedInRef.current = isSignedIn;
    // Single-flight guard shared by manual and automatic runs.
    const runningRef = useRef(false);
    // Pending retry for a failed automatic backup. Only ever one in flight.
    const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    // Set below once `maybeAutoBackup` exists; lets the retry timer re-enter it without a
    // declaration cycle, so a fired retry re-checks sign-in/mode/single-flight like any other run.
    const maybeAutoBackupRef = useRef<() => void>(() => {});

    useEffect(() => {
        let cancelled = false;
        void (async () => {
            const stored = await readBackupSettingsAsync();
            if (cancelled) return;
            setSettings(stored);
            setReady(true);
        })();
        return () => {
            cancelled = true;
        };
    }, []);

    const persist = useCallback((next: StoredBackupSettings) => {
        // Keep the ref in step immediately: callers below read it right after persisting,
        // before React has re-rendered and refreshed it.
        settingsRef.current = next;
        setSettings(next);
        void writeBackupSettingsAsync(next);
    }, []);

    const clearRetryTimer = useCallback(() => {
        if (retryTimerRef.current !== null) {
            clearTimeout(retryTimerRef.current);
            retryTimerRef.current = null;
        }
    }, []);

    /**
     * Re-arm the retry timer from persisted state. Idempotent — call it after any run and
     * whenever mode/sign-in changes. A timer only survives while the process does, so the
     * `nextRetryAt` timestamp (not the timer) is the source of truth: if the app is killed or
     * the device sleeps through the deadline, the next foreground fires the retry immediately.
     */
    const syncRetryTimer = useCallback(() => {
        clearRetryTimer();
        const { mode, nextRetryAt } = settingsRef.current;
        if (!signedInRef.current || mode !== "automatic" || nextRetryAt == null) return;
        retryTimerRef.current = setTimeout(
            () => {
                retryTimerRef.current = null;
                maybeAutoBackupRef.current();
            },
            Math.max(nextRetryAt - Date.now(), 0),
        );
    }, [clearRetryTimer]);

    /** Advance (or abandon) the backoff after an automatic backup failed. */
    const scheduleRetryAfterFailure = useCallback(
        (error: unknown) => {
            const current = settingsRef.current;
            const attempt = current.retryAttempt + 1;

            // Errors needing the user, and exhausted backoffs, stop the timer: the next
            // foreground still finds the backup due and starts a fresh attempt from scratch.
            if (!isRetryableBackupError(error) || attempt > BACKUP.maxRetryAttempts) {
                persist({ ...current, retryAttempt: 0, nextRetryAt: null });
                return;
            }

            persist({
                ...current,
                retryAttempt: attempt,
                nextRetryAt: Date.now() + retryDelayMs(attempt),
            });
        },
        [persist],
    );

    /** Core backup routine, shared by manual and automatic paths. */
    const runBackup = useCallback(
        async ({ auto }: { auto: boolean }): Promise<void> => {
            if (runningRef.current) return;
            runningRef.current = true;
            setBusy(true);
            setProgress(null);
            setLastError(null);
            try {
                const before = settingsRef.current;
                const { fileId } = await backupToDriveAsync(before.driveFileId, setProgress);
                // Merge onto the freshest settings — the user may have changed prefs mid-run.
                const current = settingsRef.current;
                persist({
                    ...current,
                    driveFileId: fileId,
                    lastBackupAt: Date.now(),
                    retryAttempt: 0,
                    nextRetryAt: null,
                });
            } catch (error) {
                setLastError((error as Error).message);
                // A failed manual run leaves any pending backoff alone — `syncRetryTimer` below
                // re-arms it — so retrying by hand can't cancel the automatic retry.
                if (auto) scheduleRetryAfterFailure(error);
                throw error;
            } finally {
                runningRef.current = false;
                setBusy(false);
                setProgress(null);
                syncRetryTimer();
            }
        },
        [persist, scheduleRetryAfterFailure, syncRetryTimer],
    );

    const backupNow = useCallback(() => runBackup({ auto: false }), [runBackup]);

    // Automatic backup: on app foreground (and once on ready), back up if the chosen period has
    // elapsed since the last success, or if a retry from an earlier failure has come due.
    // Won't run while the app is closed.
    const maybeAutoBackup = useCallback(() => {
        // A run in flight settles the timer itself when it finishes.
        if (runningRef.current) return;

        const s = settingsRef.current;
        if (!signedInRef.current || s.mode !== "automatic") {
            clearRetryTimer();
            return;
        }

        const now = Date.now();
        if (s.nextRetryAt != null && now < s.nextRetryAt) {
            // Not due yet (e.g. woken by a foreground) — make sure the timer is still armed.
            syncRetryTimer();
            return;
        }

        const intervalMs = periodDays(s.periodKey, s.customDays) * DAY_MS;
        const due =
            s.nextRetryAt != null ||
            s.lastBackupAt == null ||
            now - s.lastBackupAt >= intervalMs;
        if (!due) {
            clearRetryTimer();
            return;
        }

        // Auto-runs are silent; failures surface via lastError and a scheduled retry, not an alert.
        void runBackup({ auto: true }).catch(() => {});
    }, [clearRetryTimer, runBackup, syncRetryTimer]);

    maybeAutoBackupRef.current = maybeAutoBackup;

    useEffect(() => {
        if (!ready) return;
        maybeAutoBackup();
        const sub = AppState.addEventListener("change", (state: AppStateStatus) => {
            if (state === "active") maybeAutoBackup();
        });
        return () => sub.remove();
    }, [ready, maybeAutoBackup]);

    // Turning automatic mode off (or signing out) cancels a pending retry; turning it back on
    // re-arms one that is still outstanding.
    useEffect(() => {
        if (!ready) return;
        syncRetryTimer();
    }, [ready, isSignedIn, settings.mode, settings.nextRetryAt, syncRetryTimer]);

    useEffect(() => clearRetryTimer, [clearRetryTimer]);

    const setMode = useCallback(
        (mode: BackupMode) => persist({ ...settingsRef.current, mode }),
        [persist],
    );
    const setPeriodKey = useCallback(
        (periodKey: BackupPeriodKey) => persist({ ...settingsRef.current, periodKey }),
        [persist],
    );
    const setCustomDays = useCallback(
        (customDays: number) =>
            persist({ ...settingsRef.current, customDays: clampCustomDays(customDays) }),
        [persist],
    );

    const value = useMemo<BackupContextValue>(
        () => ({
            ready,
            mode: settings.mode,
            periodKey: settings.periodKey,
            customDays: settings.customDays,
            lastBackupAt: settings.lastBackupAt,
            busy,
            progress,
            lastError,
            nextRetryAt: settings.nextRetryAt,
            setMode,
            setPeriodKey,
            setCustomDays,
            backupNow,
        }),
        [ready, settings, busy, progress, lastError, setMode, setPeriodKey, setCustomDays, backupNow],
    );

    return <BackupContext.Provider value={value}>{children}</BackupContext.Provider>;
}

export const useBackup = (): BackupContextValue => {
    const ctx = useContext(BackupContext);
    if (!ctx) {
        throw new Error("useBackup must be used within a BackupProvider.");
    }
    return ctx;
};
