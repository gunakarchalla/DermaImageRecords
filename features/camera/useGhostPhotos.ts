import { useEffect, useRef, useState } from "react";

import { mapWithConcurrency } from "../../services/async";
import type { ConsultationCursor } from "../../services/db/dermaDb";
import { toRenderableImageUriAsync } from "../../services/imageUri";
import { consultationIndexService } from "../../services/indexing/consultationIndexService";
import { getConsultation } from "../../services/storage";

// The ghost tray is a horizontal strip, so there is no point pulling the
// patient's entire photo history into memory to fill it.
const MAX_GHOST_PHOTOS = 24;
const GHOST_PAGE_SIZE = 20;

/**
 * Load up to MAX_GHOST_PHOTOS of the patient's prior photos (newest visits first)
 * with render-safe preview URIs, once per mount, for the camera's alignment overlay.
 */
export function useGhostPhotos(patientId: string | undefined) {
    const [ghostUris, setGhostUris] = useState<string[]>([]);
    const [ghostPreviews, setGhostPreviews] = useState<Record<string, string | undefined>>({});
    const [loadingGhosts, setLoadingGhosts] = useState(false);
    const [ghostsFailed, setGhostsFailed] = useState(false);

    const requestedRef = useRef(false);

    useEffect(() => {
        if (!patientId || requestedRef.current) return;
        requestedRef.current = true;

        let cancelled = false;
        void (async () => {
            setLoadingGhosts(true);
            try {
                const uris: string[] = [];
                let cursor: ConsultationCursor | undefined;

                do {
                    const { items, nextCursor } =
                        await consultationIndexService.queryConsultationsPageAsync({
                            patientId,
                            limit: GHOST_PAGE_SIZE,
                            cursor,
                        });

                    const consultations = await Promise.all(
                        items.map((item) => getConsultation(patientId, item.id)),
                    );

                    consultations.forEach((consultation) => {
                        consultation?.photoUris.forEach((uri) => {
                            if (!uris.includes(uri)) uris.push(uri);
                        });
                    });

                    cursor = nextCursor;
                } while (cursor && uris.length < MAX_GHOST_PHOTOS);

                const capped = uris.slice(0, MAX_GHOST_PHOTOS);
                // Bounded fan-out: first visit can copy up to 24 full images into the render cache.
                const entries = await mapWithConcurrency(capped, 4, async (uri) => {
                    try {
                        return [uri, await toRenderableImageUriAsync(uri)] as const;
                    } catch {
                        return [uri, undefined] as const;
                    }
                });

                if (cancelled) return;
                setGhostUris(capped);
                setGhostPreviews(Object.fromEntries(entries));
            } catch {
                if (!cancelled) setGhostsFailed(true);
            } finally {
                if (!cancelled) setLoadingGhosts(false);
            }
        })();

        return () => {
            cancelled = true;
        };
    }, [patientId]);

    return { ghostUris, ghostPreviews, loadingGhosts, ghostsFailed };
}
