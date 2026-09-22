import { describe, expect, it } from "vitest";

import { isRemoteImageReference } from "../src/utils/upload-reference";

describe("uploaded image reference replacement", () => {
    it.each([
        "https://cdn.example.com/assets/photo.png",
        "HTTP://cdn.example.com/photo.png",
        "//cdn.example.com/photo.png",
        "data:image/png;base64,abc",
        "blob:https://example.com/id",
    ])("recognizes remote image reference %s", (path) => {
        expect(isRemoteImageReference(path)).toBe(true);
    });

    it.each(["assets/photo.png", "../assets/photo.png", "photo.png"])(
        "recognizes local image reference %s",
        (path) => {
            expect(isRemoteImageReference(path)).toBe(false);
        },
    );
});
