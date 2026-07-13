import {
    MIN_CROP_SIZE,
    clamp,
    computeImageFrame,
    cropRectToImagePixels,
    fitCropRect,
    moveCropRect,
    resizeCropRect,
    type CropRect,
} from "../cropGeometry";

const frame: CropRect = { x: 10, y: 20, width: 300, height: 400 };

describe("clamp", () => {
    it("bounds a value on both sides", () => {
        expect(clamp(5, 0, 10)).toBe(5);
        expect(clamp(-1, 0, 10)).toBe(0);
        expect(clamp(11, 0, 10)).toBe(10);
    });
});

describe("computeImageFrame", () => {
    it("letterboxes a wide image top/bottom", () => {
        const result = computeImageFrame({ width: 100, height: 100 }, { width: 200, height: 100 });
        expect(result).toEqual({ x: 0, y: 25, width: 100, height: 50 });
    });

    it("letterboxes a tall image left/right", () => {
        const result = computeImageFrame({ width: 100, height: 100 }, { width: 100, height: 200 });
        expect(result).toEqual({ x: 25, y: 0, width: 50, height: 100 });
    });
});

describe("fitCropRect", () => {
    it("free-form crop insets 12% on each side", () => {
        const rect = fitCropRect(frame, null);
        expect(rect.x).toBeCloseTo(frame.x + frame.width * 0.12);
        expect(rect.y).toBeCloseTo(frame.y + frame.height * 0.12);
        expect(rect.width).toBeCloseTo(frame.width * 0.76);
        expect(rect.height).toBeCloseTo(frame.height * 0.76);
    });

    it("locked aspect stays centred and matches the ratio", () => {
        const rect = fitCropRect(frame, 1);
        expect(rect.width).toBeCloseTo(rect.height);
        // Centred horizontally within the frame.
        expect(rect.x - frame.x).toBeCloseTo(frame.x + frame.width - (rect.x + rect.width));
    });
});

describe("moveCropRect", () => {
    const start: CropRect = { x: 50, y: 60, width: 100, height: 100 };

    it("translates freely inside the frame", () => {
        expect(moveCropRect(start, frame, 10, -5)).toEqual({
            x: 60,
            y: 55,
            width: 100,
            height: 100,
        });
    });

    it("clamps to the frame edges", () => {
        const moved = moveCropRect(start, frame, 10_000, 10_000);
        expect(moved.x).toBe(frame.x + frame.width - start.width);
        expect(moved.y).toBe(frame.y + frame.height - start.height);
    });
});

describe("resizeCropRect", () => {
    const start: CropRect = { x: 100, y: 100, width: 120, height: 120 };

    it("keeps the opposite corner pinned", () => {
        const resized = resizeCropRect(start, frame, null, "bottomRight", 30, 40);
        expect(resized.x).toBe(start.x);
        expect(resized.y).toBe(start.y);
        expect(resized.width).toBe(150);
        expect(resized.height).toBe(160);
    });

    it("never shrinks below the minimum size", () => {
        // -70 would leave a 50px rect; it clamps to the 56px minimum instead. (A drag far
        // past the anchor mirrors the rect rather than shrinking it — Math.abs semantics.)
        const resized = resizeCropRect(start, frame, null, "bottomRight", -70, -70);
        expect(resized.width).toBe(MIN_CROP_SIZE);
        expect(resized.height).toBe(MIN_CROP_SIZE);
    });

    it("preserves a locked aspect ratio", () => {
        const resized = resizeCropRect(start, frame, 1, "bottomRight", 60, 10);
        expect(resized.width).toBeCloseTo(resized.height);
    });

    it("stays inside the frame when dragged past the edge", () => {
        const resized = resizeCropRect(start, frame, null, "bottomRight", 10_000, 10_000);
        expect(resized.x + resized.width).toBeLessThanOrEqual(frame.x + frame.width);
        expect(resized.y + resized.height).toBeLessThanOrEqual(frame.y + frame.height);
    });
});

describe("cropRectToImagePixels", () => {
    it("maps screen space to image pixels", () => {
        // Frame at 2x scale: image is 600x800 shown in a 300x400 frame.
        const rect: CropRect = { x: 60, y: 120, width: 100, height: 100 };
        const pixels = cropRectToImagePixels(rect, frame, { width: 600, height: 800 });
        expect(pixels).toEqual({ originX: 100, originY: 200, width: 200, height: 200 });
    });

    it("clamps to the image bounds", () => {
        const rect: CropRect = { x: frame.x, y: frame.y, width: frame.width, height: frame.height };
        const pixels = cropRectToImagePixels(rect, frame, { width: 600, height: 800 });
        expect(pixels.originX).toBe(0);
        expect(pixels.originY).toBe(0);
        expect(pixels.width).toBe(600);
        expect(pixels.height).toBe(800);
    });
});
