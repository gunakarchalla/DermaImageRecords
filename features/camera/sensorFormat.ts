/** Pure sensor-geometry helpers for the consultation camera. */

export type SensorFormat = { pictureSize: string; previewAspect: number };

// Portrait width / height. Nearly every phone sensor is 4:3, and iOS only ever
// hands back 4:3 stills from the wide lens, so this is the fallback when the
// device won't tell us its picture sizes.
export const DEFAULT_PREVIEW_ASPECT = 3 / 4;

// Android reports picture sizes as "<width>x<height>" in landscape orientation.
const PICTURE_SIZE_PATTERN = /^(\d+)x(\d+)$/;

/**
 * Pick the largest picture the sensor offers and derive the portrait aspect ratio
 * of the frame it produces.
 *
 * This is what keeps the viewfinder honest. The preview's scaleType is FILL, so
 * the camera feed gets centre-cropped to whatever bounds the CameraView is given
 * — but `takePictureAsync` always reads the full sensor frame. Laying the preview
 * out at exactly this aspect ratio makes FILL and FIT identical, so what is framed
 * is what is saved. (`ratio` would force FIT, but it is Android-only and is
 * ignored once `pictureSize` is set.)
 */
export const pickLargestSensorFormat = (sizes: string[]): SensorFormat | null => {
    let best: (SensorFormat & { area: number }) | null = null;

    for (const size of sizes) {
        const match = PICTURE_SIZE_PATTERN.exec(size);
        if (!match) continue; // iOS returns preset names ("Photo", "High"), not dimensions.

        const width = Number(match[1]);
        const height = Number(match[2]);
        if (!width || !height) continue;

        const area = width * height;
        if (best && area <= best.area) continue;

        const shortSide = Math.min(width, height);
        const longSide = Math.max(width, height);
        best = { pictureSize: size, previewAspect: shortSide / longSide, area };
    }

    return best ? { pictureSize: best.pictureSize, previewAspect: best.previewAspect } : null;
};
