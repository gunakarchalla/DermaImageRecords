import { useSyncExternalStore } from "react";

/**
 * A counter bumped whenever the dataset is rewritten wholesale — a file import or a cloud
 * restore — rather than through the ordinary per-record save/delete paths.
 *
 * Screens reload their data on focus, which covers every mutation the user reaches by
 * navigating. A restore offered right after sign-in does not fit that shape: it finishes while
 * the patient list is already mounted and focused, so nothing would tell it to re-query and the
 * user would stare at an empty list until they switched tabs. Subscribing to this revision does.
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
