// Multi-device sync configuration. The dataset on disk stays the source of truth; the
// user's own Google Drive holds a visible mirror of it (folder "DermaImageRecords"),
// reconciled by a state-based diff (see services/sync/).

export const SYNC = {
    // Minimal Drive scope: the app can only see files it created itself.
    driveScope: "https://www.googleapis.com/auth/drive.file",

    /** appProperties stamped on the remote dataset root so it can be re-found after renames. */
    appPropertyKey: "app",
    appPropertyValue: "dermaimagerecords",
    rootRoleKey: "role",
    rootRoleValue: "datasetRoot",

    /** Remote folder holding sync metadata (per-device tombstone files). */
    syncMetaFolderName: ".sync",

    /** Parallel uploads/downloads. Drive tolerates ~2–3 writes/sec/user sustained. */
    transferConcurrency: 3,

    /** Local edits settle for this long before a sync is triggered. */
    mutationDebounceMs: 15_000,

    /** Re-sync interval while the app stays in the foreground. */
    periodicIntervalMs: 15 * 60_000,

    /** Follow-up cycles after structural changes (renames/collisions), to converge fast. */
    maxChainedRuns: 2,

    // Failed automatic syncs retry on an exponential backoff: 1, 2, 4, 8, 16 min (capped).
    retryBaseDelayMs: 60_000,
    retryMaxDelayMs: 30 * 60_000,
    maxRetryAttempts: 5,
} as const;

/**
 * Delay before the `attempt`-th consecutive retry of a failed sync (1-based),
 * doubling each time and capped at `retryMaxDelayMs`.
 */
export const syncRetryDelayMs = (attempt: number): number =>
    Math.min(SYNC.retryBaseDelayMs * 2 ** Math.max(0, attempt - 1), SYNC.retryMaxDelayMs);
