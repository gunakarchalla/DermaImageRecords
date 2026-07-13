import { pickLargestSensorFormat } from "../sensorFormat";

describe("pickLargestSensorFormat", () => {
    it("picks the largest area and derives the portrait aspect", () => {
        const result = pickLargestSensorFormat(["1920x1080", "4000x3000", "640x480"]);
        expect(result).toEqual({ pictureSize: "4000x3000", previewAspect: 3000 / 4000 });
    });

    it("ignores iOS preset names", () => {
        expect(pickLargestSensorFormat(["Photo", "High"])).toBeNull();
    });

    it("ignores malformed and zero-dimension entries", () => {
        const result = pickLargestSensorFormat(["0x100", "abc", "800x600"]);
        expect(result).toEqual({ pictureSize: "800x600", previewAspect: 600 / 800 });
    });

    it("returns null for an empty list", () => {
        expect(pickLargestSensorFormat([])).toBeNull();
    });
});
