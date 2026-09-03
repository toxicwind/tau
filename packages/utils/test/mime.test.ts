import { expect, test, describe } from "bun:test";
import { parseImageMetadata } from "../src/mime";

describe("parseImageMetadata", () => {
    test("should identify PNG", () => {
        const header = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 1, 0, 0, 0, 1]);
        const result = parseImageMetadata(header);
        expect(result?.mimeType).toBe("image/png");
    });

    test("should identify JPEG", () => {
        const header = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46]);
        const result = parseImageMetadata(header);
        expect(result?.mimeType).toBe("image/jpeg");
    });

    test("should identify GIF", () => {
        const header = Buffer.from("GIF89a");
        const result = parseImageMetadata(header);
        expect(result?.mimeType).toBe("image/gif");
    });

    test("should identify WEBP", () => {
        // RIFF + size + WEBP + VP8
        const header = Buffer.from([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x20]);
        const result = parseImageMetadata(header);
        expect(result?.mimeType).toBe("image/webp");
    });
});
