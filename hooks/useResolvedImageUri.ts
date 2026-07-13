import { useEffect, useMemo, useState } from "react";

import { mapWithConcurrency } from "../services/async";
import { toRenderableImageUriAsync } from "../services/imageUri";

/**
 * Resolve one persisted image URI (possibly SAF `content://`) to a render-safe URI.
 * `version` re-runs resolution when the underlying content may have changed behind the
 * same URI (e.g. `patient.updatedAt`); an unchanged file resolves to the same cache entry,
 * so re-running is a metadata query, not a copy.
 */
export function useResolvedImageUri(uri?: string | null, version?: string): string | undefined {
    const [resolved, setResolved] = useState<string | undefined>();

    useEffect(() => {
        let cancelled = false;

        void (async () => {
            try {
                const out = await toRenderableImageUriAsync(uri);
                if (!cancelled) setResolved(out);
            } catch {
                if (!cancelled) setResolved(undefined);
            }
        })();

        return () => {
            cancelled = true;
        };
    }, [uri, version]);

    return resolved;
}

/**
 * Resolve a list of persisted photo URIs to render-safe URIs, keyed by the original URI.
 * URIs that fail to resolve are simply absent from the map (callers fall back per-photo).
 */
export function useResolvedPhotoUris(uris: readonly string[]): Record<string, string> {
    const [map, setMap] = useState<Record<string, string>>({});

    // A new array with the same URIs must not re-trigger resolution.
    const key = uris.join("\n");

    useEffect(() => {
        let cancelled = false;
        const list = key ? key.split("\n") : [];

        void (async () => {
            const resolved = await mapWithConcurrency(list, 4, async (uri) => {
                try {
                    return [uri, await toRenderableImageUriAsync(uri)] as const;
                } catch {
                    return [uri, undefined] as const;
                }
            });
            if (cancelled) return;

            const next: Record<string, string> = {};
            for (const [uri, out] of resolved) {
                if (out) next[uri] = out;
            }
            setMap(next);
        })();

        return () => {
            cancelled = true;
        };
    }, [key]);

    return useMemo(() => map, [map]);
}
