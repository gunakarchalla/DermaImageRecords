import { useIsFocused } from "@react-navigation/native";
import { useEffect, useRef } from "react";

import { useDatasetRevision } from "../services/datasetRevision";

/**
 * Run `load` when the screen first gains focus, and again only when the dataset has
 * actually changed since the last run (any storage mutation, import, or restore bumps
 * the dataset revision). Replaces the old reload-on-every-focus pattern, which reset
 * pagination and re-resolved every image each time the user navigated back.
 *
 * While the screen stays focused, a revision bump also triggers `load` — this is how a
 * screen refreshes after its own mutations and after background imports.
 *
 * `load`'s identity is deliberately NOT a trigger: screens with query/sort/search inputs
 * reload through their own effects when those change.
 */
export function useDatasetFocusRefresh(load: () => void) {
    const revision = useDatasetRevision();
    const isFocused = useIsFocused();
    const loadedRevisionRef = useRef<number | null>(null);

    useEffect(() => {
        if (!isFocused) return;
        if (loadedRevisionRef.current === revision) return;
        loadedRevisionRef.current = revision;
        load();
    }, [isFocused, revision, load]);
}
