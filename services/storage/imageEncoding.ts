import { ImageManipulator, SaveFormat, type ImageRef } from "expo-image-manipulator";

import {
    IMAGE_FORMATS,
    effectiveCompress,
    type ImageFormat,
    type MaxDimension,
} from "../../constants/preferences";
import { getActiveImageSettingsAsync } from "../preferences/imageSettings";

const SAVE_FORMAT: Record<ImageFormat, SaveFormat> = {
    jpeg: SaveFormat.JPEG,
    png: SaveFormat.PNG,
    webp: SaveFormat.WEBP,
};

/**
 * Longest-edge cap. Returns `null` when the image already fits, so we never upscale.
 * Only the longer edge is passed to `resize` — the native side derives the other one
 * from the aspect ratio, which avoids the rounding drift of computing both ourselves.
 */
const resizeTargetFor = (width: number, height: number, maxDimension: MaxDimension) => {
    if (!maxDimension) return null;
    if (Math.max(width, height) <= maxDimension) return null;
    return width >= height ? { width: maxDimension } : { height: maxDimension };
};

export type EncodedImage = { uri: string; ext: string; mimeType: string };

/**
 * Re-encode a freshly captured/picked image using the user's image settings, returning a
 * cache URI plus the extension and mime type the destination file must be created with.
 *
 * The caller decides the filename, because the extension is only known here.
 */
export const encodeImageForStorageAsync = async (sourceUri: string): Promise<EncodedImage> => {
    const settings = await getActiveImageSettingsAsync();
    const { ext, mimeType } = IMAGE_FORMATS[settings.format];

    // Contexts and image refs hold native bitmaps until released. saveConsultation encodes
    // photos in a loop, so leaving them to the GC stacks up full-resolution frames.
    // `manipulateAsync` releases the same way.
    const nativeRefs: { release: () => void }[] = [];

    try {
        const decodeContext = ImageManipulator.manipulate(sourceUri);
        nativeRefs.push(decodeContext);

        // renderAsync decodes once and applies EXIF orientation, so these dimensions are the
        // ones the user actually sees. (RNImage.getSize reports the raw, unrotated frame.)
        const decoded = await decodeContext.renderAsync();
        nativeRefs.push(decoded);

        let image: ImageRef = decoded;
        const target = resizeTargetFor(decoded.width, decoded.height, settings.maxDimension);
        if (target) {
            const resizeContext = ImageManipulator.manipulate(decoded).resize(target);
            nativeRefs.push(resizeContext);
            image = await resizeContext.renderAsync();
            nativeRefs.push(image);
        }

        const result = await image.saveAsync({
            compress: effectiveCompress(settings),
            format: SAVE_FORMAT[settings.format],
        });

        return { uri: result.uri, ext, mimeType };
    } finally {
        for (const ref of nativeRefs.reverse()) ref.release();
    }
};
