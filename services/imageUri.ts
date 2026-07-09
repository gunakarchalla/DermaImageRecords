import { Directory, File, Paths } from "expo-file-system";

import { STORAGE } from "../constants/storage";

/**
 * Some providers (notably SAF `content://` document URIs) don't reliably render in all
 * image components on Android. We keep SAF/content URIs as the persisted source-of-truth,
 * but convert them to a local cache `file://` URI for rendering.
 */

const IMAGE_CACHE_DIR = new Directory(Paths.cache, STORAGE.imageCacheFolderName);

const ensureCacheDir = async () => {
    // Create directory tree if missing.
    // Using `idempotent: true` makes repeated calls safe.
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

const findChildFile = (parent: Directory, name: string): File | null => {
    try {
        if (!parent.exists) return null;
        const entry = parent.list().find((item) => item instanceof File && item.name === name);
        return (entry as File | undefined) ?? null;
    } catch {
        return null;
    }
};

const createOrGetCacheFileAsync = async (name: string, mimeType: string) => {
    await ensureCacheDir();

    const existing = findChildFile(IMAGE_CACHE_DIR, name);
    if (existing?.exists) return existing;

    try {
        return await IMAGE_CACHE_DIR.createFile(name, mimeType);
    } catch {
        // Race: if another call created it, return the existing one.
        const after = findChildFile(IMAGE_CACHE_DIR, name);
        if (after) return after;
        throw new Error("Failed to create cached image file.");
    }
};

const guessMimeType = (uri: string): { ext: string; mimeType: string } => {
    const lowered = uri.toLowerCase();
    if (lowered.includes(".png")) return { ext: "png", mimeType: "image/png" };
    if (lowered.includes(".webp")) return { ext: "webp", mimeType: "image/webp" };
    // Default to jpeg: the historical format, and still the default image setting.
    return { ext: "jpg", mimeType: "image/jpeg" };
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

    const { ext, mimeType } = guessMimeType(uri);
    const fileName = `${djb2Hash(uri)}.${ext}`;

    // Copy bytes from the original URI into cache.
    const destination = await createOrGetCacheFileAsync(fileName, mimeType);

    // If the destination exists but is empty/corrupt, overwrite it.
    // We can't reliably check size, so we do a best-effort write each time for non-file URIs.
    // This keeps behavior predictable after providers revoke/restore access.
    const source = new File(uri);
    const bytes = await source.bytes();
    await destination.write(bytes);

    return destination.uri;
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
