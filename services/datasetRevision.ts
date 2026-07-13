import { useSyncExternalStore } from "react";

/**
 * A counter bumped on every dataset mutation: per-record saves/deletes in
 * services/storage/storage.ts as well as wholesale rewrites (file import, cloud restore).
 *
 * Screens subscribe via useDatasetFocusRefresh and re-query only when this changed since
 * their last load — navigating back to an unchanged screen costs nothing. A bump while a
 * screen is focused (its own mutation, or an import finishing behind it) refreshes it
 * immediately.
 */

let revision = 0;
const listeners = new Set<() => void>();

export const bumpDatasetRevision = (): void => {
    revision += 1;
    for (const listener of listeners) listener();
};

const subscribe = (listener: () => void): (() => void) => {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
};

const getSnapshot = (): number => revision;

export const useDatasetRevision = (): number =>
    useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
