/**
 * Pure geometry for the photo crop editor. No React, no I/O — every function maps
 * screen-space rectangles, so the editor's drag/resize behavior is unit-testable.
 */

export type CropRect = {
    x: number;
    y: number;
    width: number;
    height: number;
};

export type Size = { width: number; height: number };

export type ResizeCorner = "topLeft" | "topRight" | "bottomLeft" | "bottomRight";

export const MIN_CROP_SIZE = 56;
export const CROP_CANVAS_PADDING = 12;

/** `null` is a free-form crop; the numbers are width / height. */
export const ASPECT_PRESETS: { label: string; value: number | null }[] = [
    { label: "Free", value: null },
    { label: "1:1", value: 1 },
    { label: "4:3", value: 4 / 3 },
    { label: "3:4", value: 3 / 4 },
];

export const clamp = (value: number, min: number, max: number) =>
    Math.max(min, Math.min(max, value));

/** Letterboxed rect the image actually occupies inside a `contentFit="contain"` canvas. */
export const computeImageFrame = (canvas: Size, image: Size): CropRect => {
    const imageAspect = image.width / image.height;
    const canvasAspect = canvas.width / canvas.height;

    if (imageAspect > canvasAspect) {
        const frameHeight = canvas.width / imageAspect;
        return {
            x: 0,
            y: (canvas.height - frameHeight) / 2,
            width: canvas.width,
            height: frameHeight,
        };
    }

    const frameWidth = canvas.height * imageAspect;
    return {
        x: (canvas.width - frameWidth) / 2,
        y: 0,
        width: frameWidth,
        height: canvas.height,
    };
};

/** Starting crop rectangle: inset from the image frame, honouring a locked aspect ratio. */
export const fitCropRect = (frame: CropRect, aspect: number | null): CropRect => {
    if (aspect === null) {
        const marginX = frame.width * 0.12;
        const marginY = frame.height * 0.12;
        return {
            x: frame.x + marginX,
            y: frame.y + marginY,
            width: Math.max(MIN_CROP_SIZE, frame.width - marginX * 2),
            height: Math.max(MIN_CROP_SIZE, frame.height - marginY * 2),
        };
    }

    const maxWidth = frame.width * 0.86;
    const maxHeight = frame.height * 0.86;

    let width = maxWidth;
    let height = width / aspect;
    if (height > maxHeight) {
        height = maxHeight;
        width = height * aspect;
    }

    return {
        x: frame.x + (frame.width - width) / 2,
        y: frame.y + (frame.height - height) / 2,
        width,
        height,
    };
};

/** The crop rect after dragging its body by (dx, dy), kept inside the image frame. */
export const moveCropRect = (start: CropRect, frame: CropRect, dx: number, dy: number): CropRect => ({
    x: clamp(start.x + dx, frame.x, frame.x + frame.width - start.width),
    y: clamp(start.y + dy, frame.y, frame.y + frame.height - start.height),
    width: start.width,
    height: start.height,
});

/**
 * The crop rect after dragging `corner` by (dx, dy). The opposite corner stays pinned;
 * a locked aspect ratio is preserved (width leads, falling back to height-leads when the
 * derived height would overflow the space between the anchor and the image edge).
 */
export const resizeCropRect = (
    start: CropRect,
    frame: CropRect,
    aspect: number | null,
    corner: ResizeCorner,
    dx: number,
    dy: number,
): CropRect => {
    const isLeft = corner === "topLeft" || corner === "bottomLeft";
    const isTop = corner === "topLeft" || corner === "topRight";

    const anchorX = isLeft ? start.x + start.width : start.x;
    const anchorY = isTop ? start.y + start.height : start.y;
    const movingX = (isLeft ? start.x : start.x + start.width) + dx;
    const movingY = (isTop ? start.y : start.y + start.height) + dy;

    const spaceX = isLeft ? anchorX - frame.x : frame.x + frame.width - anchorX;
    const spaceY = isTop ? anchorY - frame.y : frame.y + frame.height - anchorY;

    let nextWidth = clamp(Math.abs(movingX - anchorX), MIN_CROP_SIZE, spaceX);
    let nextHeight = clamp(Math.abs(movingY - anchorY), MIN_CROP_SIZE, spaceY);

    if (aspect) {
        nextHeight = nextWidth / aspect;
        if (nextHeight > spaceY || nextHeight < MIN_CROP_SIZE) {
            nextHeight = clamp(nextHeight, MIN_CROP_SIZE, spaceY);
            nextWidth = clamp(nextHeight * aspect, MIN_CROP_SIZE, spaceX);
            nextHeight = nextWidth / aspect;
        }
    }

    return {
        x: isLeft ? anchorX - nextWidth : anchorX,
        y: isTop ? anchorY - nextHeight : anchorY,
        width: nextWidth,
        height: nextHeight,
    };
};

/**
 * Map a screen-space crop rect to source-image pixel coordinates, clamped to the
 * image bounds — the exact rectangle handed to ImageManipulator's crop action.
 */
export const cropRectToImagePixels = (
    rect: CropRect,
    frame: CropRect,
    image: Size,
): { originX: number; originY: number; width: number; height: number } => {
    const scaleX = image.width / frame.width;
    const scaleY = image.height / frame.height;

    const originX = clamp(Math.round((rect.x - frame.x) * scaleX), 0, image.width - 1);
    const originY = clamp(Math.round((rect.y - frame.y) * scaleY), 0, image.height - 1);

    return {
        originX,
        originY,
        width: clamp(Math.round(rect.width * scaleX), 1, image.width - originX),
        height: clamp(Math.round(rect.height * scaleY), 1, image.height - originY),
    };
};
