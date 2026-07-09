// User-facing app preferences (theme, font size, photo encoding).
// Persisted as config (not data) in the app sandbox — see services/preferences.
// The filesystem dataset remains the source-of-truth for records; these are UI prefs only.

export type ThemePreference = "light" | "dark";

export const PREFERENCES = {
    // Stored in app sandbox Documents (config, not data).
    fileName: "DermaImageRecords.preferences.json",
    defaultTheme: "light" as ThemePreference,
    // Index into FONT_SCALE_STEPS.
    defaultFontStep: 1,
} as const;

// Stepped, app-wide font sizing. `scale` multiplies every explicit fontSize
// at render time (see services/preferences/fontScaling.ts).
export const FONT_SCALE_STEPS = [
    { key: "small", label: "Small", scale: 0.85 },
    { key: "default", label: "Default", scale: 1.0 },
    { key: "large", label: "Large", scale: 1.15 },
    { key: "xlarge", label: "Extra Large", scale: 1.3 },
] as const;

export const clampFontStep = (step: number): number =>
    Math.min(Math.max(Math.round(step), 0), FONT_SCALE_STEPS.length - 1);

export const fontScaleForStep = (step: number): number =>
    FONT_SCALE_STEPS[clampFontStep(step)].scale;

// ---------------------------------------------------------------------------
// Photo encoding
// ---------------------------------------------------------------------------
// Applied when a photo is written to the dataset (see services/storage/imageEncoding.ts).
// Existing photos on disk are never re-encoded, so a stored photo keeps whatever format
// was configured at the time it was saved — which is why nothing may assume `.jpg`.

export type ImageFormat = "jpeg" | "png" | "webp";

/** Longest-edge cap in pixels. `null` keeps the source dimensions. */
export type MaxDimension = number | null;

export type ImageSettings = {
    format: ImageFormat;
    /** Compression level, `IMAGE_QUALITY_RANGE.min`–`1`. Ignored by lossless formats. */
    quality: number;
    maxDimension: MaxDimension;
};

export const IMAGE_FORMATS = {
    jpeg: { label: "JPEG", ext: "jpg", mimeType: "image/jpeg", lossless: false },
    png: { label: "PNG", ext: "png", mimeType: "image/png", lossless: true },
    webp: { label: "WebP", ext: "webp", mimeType: "image/webp", lossless: false },
} as const satisfies Record<ImageFormat, { label: string; ext: string; mimeType: string; lossless: boolean }>;

/** Display order for the format picker. */
export const IMAGE_FORMAT_KEYS = ["jpeg", "png", "webp"] as const satisfies readonly ImageFormat[];

export const IMAGE_QUALITY_RANGE = { min: 0.1, max: 1, step: 0.05 } as const;

export const MAX_DIMENSION_OPTIONS = [
    { label: "Original", value: null },
    { label: "4096 px", value: 4096 },
    { label: "2048 px", value: 2048 },
    { label: "1280 px", value: 1280 },
] as const satisfies readonly { label: string; value: MaxDimension }[];

/** Matches the encoding used before this setting existed, so upgrading changes nothing. */
export const DEFAULT_IMAGE_SETTINGS: ImageSettings = {
    format: "jpeg",
    quality: 0.7,
    maxDimension: null,
};

export const IMAGE_PRESETS = [
    {
        key: "spaceSaver",
        label: "Space Saver",
        hint: "Smallest files",
        settings: { format: "jpeg", quality: 0.5, maxDimension: 2048 },
    },
    {
        key: "balanced",
        label: "Balanced",
        hint: "Recommended",
        settings: DEFAULT_IMAGE_SETTINGS,
    },
    {
        key: "maxQuality",
        label: "Max Quality",
        hint: "Largest files",
        settings: { format: "jpeg", quality: 1, maxDimension: null },
    },
] as const satisfies readonly { key: string; label: string; hint: string; settings: ImageSettings }[];

export type ImagePresetKey = (typeof IMAGE_PRESETS)[number]["key"];

export const clampImageQuality = (quality: number): number => {
    if (!Number.isFinite(quality)) return DEFAULT_IMAGE_SETTINGS.quality;
    return Math.min(Math.max(quality, IMAGE_QUALITY_RANGE.min), IMAGE_QUALITY_RANGE.max);
};

const isImageFormat = (value: unknown): value is ImageFormat =>
    typeof value === "string" && Object.prototype.hasOwnProperty.call(IMAGE_FORMATS, value);

// Snap to a supported option so the picker always has exactly one selected chip,
// even if the persisted file was hand-edited or written by an older build.
const normalizeMaxDimension = (value: unknown): MaxDimension => {
    if (typeof value !== "number" || !Number.isFinite(value)) return null;
    const match = MAX_DIMENSION_OPTIONS.find((option) => option.value === Math.round(value));
    return match?.value ?? null;
};

/** Corrupt or partial persisted settings must never break photo saving; fall back per-field. */
export const normalizeImageSettings = (raw: Partial<ImageSettings> | null | undefined): ImageSettings => {
    if (!raw || typeof raw !== "object") return DEFAULT_IMAGE_SETTINGS;
    return {
        format: isImageFormat(raw.format) ? raw.format : DEFAULT_IMAGE_SETTINGS.format,
        quality: clampImageQuality(
            typeof raw.quality === "number" ? raw.quality : DEFAULT_IMAGE_SETTINGS.quality,
        ),
        maxDimension: normalizeMaxDimension(raw.maxDimension),
    };
};

const imageSettingsEqual = (a: ImageSettings, b: ImageSettings): boolean =>
    a.format === b.format &&
    a.maxDimension === b.maxDimension &&
    Math.abs(a.quality - b.quality) < 1e-6;

/** The preset these settings correspond to, or `null` when the user has customised them. */
export const matchImagePreset = (settings: ImageSettings): ImagePresetKey | null =>
    IMAGE_PRESETS.find((preset) => imageSettingsEqual(preset.settings, settings))?.key ?? null;

/** Lossless formats ignore the quality slider — always hand them the highest value. */
export const effectiveCompress = (settings: ImageSettings): number =>
    IMAGE_FORMATS[settings.format].lossless ? 1 : clampImageQuality(settings.quality);

/** One-line summary for the settings screen, e.g. "JPEG · 50% quality · max 2048 px". */
export const describeImageSettings = (settings: ImageSettings): string => {
    const format = IMAGE_FORMATS[settings.format];
    const parts: string[] = [format.label];
    if (!format.lossless) parts.push(`${Math.round(settings.quality * 100)}% quality`);
    parts.push(settings.maxDimension ? `max ${settings.maxDimension} px` : "original size");
    return parts.join(" · ");
};
