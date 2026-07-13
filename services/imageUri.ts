import { Directory, File, Paths } from "expo-file-system";

import { STORAGE } from "../constants/storage";

/**
 * Some providers (notably SAF `content://` document URIs) don't reliably render in all
 * image components on Android. We keep SAF/content URIs as the persisted source-of-truth,
 * but convert them to a local cache `file://` URI for rendering.
 *
 * Cache filenames are fingerprinted with the source's size + modification time, so:
 * - an unchanged source resolves to an existing cache file with **no byte copy** — the
 *   only cost is one metadata query against the provider;
 * - a mutated source (e.g. a replaced profile photo behind the same URI) fingerprints to a
 *   new name, which also gives expo-image a fresh URI to cache — no cache-buster params.
 */

const IMAGE_CACHE_DIR = new Directory(Paths.cache, STORAGE.imageCacheFolderName);

/** Callers resolving the same cache entry concurrently share one copy operation. */
const inFlight = new Map<string, Promise<string>>();

const ensureCacheDir = async () => {
    // `idempotent: true` makes repeated calls safe.
    await IMAGE_CACHE_DIR.create({ intermediates: true, idempotent: true });
};

const djb2Hash = (input: string) => {
    // Fast, deterministic string hash for stable cache filenames.
    let hash = 5381;
    for (let i = 0; i < input.length; i += 1) {
        hash = (hash * 33) ^ input.charCodeAt(i);
    }
    // Convert to an unsigned base36 string.
    return (hash >>> 0).toString(36);
};

const guessMimeType = (uri: string): { ext: string } => {
    const lowered = uri.toLowerCase();
    if (lowered.includes(".png")) return { ext: "png" };
    if (lowered.includes(".webp")) return { ext: "webp" };
    // Default to jpeg: the historical format, and still the default image setting.
    return { ext: "jpg" };
};

/**
 * Best-effort removal of cache entries for older fingerprints of the same source, so a
 * mutated source doesn't strand its previous copies until the next full cache wipe.
 */
const deleteStaleVersions = (uriHash: string, keepName: string) => {
    try {
        for (const entry of IMAGE_CACHE_DIR.list()) {
            if (entry instanceof File && entry.name !== keepName && entry.name.startsWith(`${uriHash}-`)) {
                try {
                    entry.delete();
                } catch {
                    // Ignore: another caller may still be reading it; it gets swept later.
                }
            }
        }
    } catch {
        // Listing failures are non-fatal; stale entries are harmless.
    }
};

const copyIntoCacheAsync = async (uri: string, uriHash: string, cacheName: string): Promise<string> => {
    await ensureCacheDir();

    const destination = new File(IMAGE_CACHE_DIR, cacheName);
    if (destination.exists && destination.size > 0) return destination.uri;

    // Write to a temp name, then move into place, so a concurrent reader can never observe
    // a half-written cache file.
    const temp = new File(IMAGE_CACHE_DIR, `${cacheName}.tmp-${Math.random().toString(36).slice(2, 8)}`);
    try {
        const bytes = await new File(uri).bytes();
        temp.write(bytes);
        temp.move(destination);
    } catch (error) {
        try {
            if (temp.exists) temp.delete();
        } catch {
            // Leftover temp files are cleaned with the cache.
        }
        // Lost a race against another writer? The winner's file serves fine.
        if (destination.exists && destination.size > 0) return destination.uri;
        throw error;
    }

    deleteStaleVersions(uriHash, cacheName);
    return destination.uri;
};

/**
 * Converts arbitrary image URIs to a render-safe URI.
 * - `file://`, `http(s)://`, and `data:` URIs are returned as-is.
 * - Other schemes (typically `content://`) are copied into app cache and returned as `file://`.
 */
export const toRenderableImageUriAsync = async (uri?: string | null): Promise<string | undefined> => {
    if (!uri) return undefined;

    // Common schemes that should render directly.
    if (
        uri.startsWith("file://") ||
        uri.startsWith("http://") ||
        uri.startsWith("https://") ||
        uri.startsWith("data:")
    ) {
        return uri;
    }

    // Metadata-only provider query; no bytes are read here.
    const source = new File(uri);
    const fingerprint = `${source.size}-${source.modificationTime ?? 0}`;
    const uriHash = djb2Hash(uri);
    const cacheName = `${uriHash}-${fingerprint}.${guessMimeType(uri).ext}`;

    const existing = new File(IMAGE_CACHE_DIR, cacheName);
    if (existing.exists && existing.size > 0) return existing.uri;

    const pending = inFlight.get(cacheName);
    if (pending) return pending;

    const task = copyIntoCacheAsync(uri, uriHash, cacheName).finally(() => {
        inFlight.delete(cacheName);
    });
    inFlight.set(cacheName, task);
    return task;
};

/**
 * Delete all render-safe cached copies. Used when wiping data so stale previews
 * don't linger; the cache is rebuilt lazily on the next render.
 */
export const clearImageCacheAsync = async (): Promise<void> => {
    try {
        if (IMAGE_CACHE_DIR.exists) IMAGE_CACHE_DIR.delete();
    } catch {
        // Best-effort; a leftover cache dir is harmless and self-heals.
    }
};
