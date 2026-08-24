import { describe, expect, it, vi } from "vitest";

vi.mock("obsidian", () => ({ TFile: class TFile {} }));

import { TFile, type App } from "obsidian";
import { ImageScanner } from "../src/utils/image-scanner";

function file(path: string, size: number, mtime: number, ctime: number): TFile {
    const name = path.slice(path.lastIndexOf("/") + 1);
    const result = new TFile();
    result.path = path;
    result.name = name;
    result.stat = { size, mtime, ctime };
    return result;
}

describe("image scanner sorting", () => {
    const scanner = new ImageScanner({} as App, []);
    const files = [
        file("z/beta.png", 20, 30, 10),
        file("a/charlie.png", 20, 20, 20),
        file("m/alpha.png", 10, 10, 30),
    ];

    it("sorts every local browser field in ascending and descending order", () => {
        expect(
            scanner.sortImages(files, "name", "asc").map((item) => item.name),
        ).toEqual(["alpha.png", "beta.png", "charlie.png"]);
        expect(
            scanner.sortImages(files, "name", "desc").map((item) => item.name),
        ).toEqual(["charlie.png", "beta.png", "alpha.png"]);
        expect(
            scanner.sortImages(files, "size", "asc").map((item) => item.path),
        ).toEqual(["m/alpha.png", "a/charlie.png", "z/beta.png"]);
        expect(
            scanner.sortImages(files, "size", "desc").map((item) => item.path),
        ).toEqual(["a/charlie.png", "z/beta.png", "m/alpha.png"]);
        expect(
            scanner
                .sortImages(files, "modified", "asc")
                .map((item) => item.name),
        ).toEqual(["alpha.png", "charlie.png", "beta.png"]);
        expect(
            scanner
                .sortImages(files, "modified", "desc")
                .map((item) => item.name),
        ).toEqual(["beta.png", "charlie.png", "alpha.png"]);
        expect(
            scanner
                .sortImages(files, "created", "asc")
                .map((item) => item.name),
        ).toEqual(["beta.png", "charlie.png", "alpha.png"]);
        expect(
            scanner
                .sortImages(files, "created", "desc")
                .map((item) => item.name),
        ).toEqual(["alpha.png", "charlie.png", "beta.png"]);
    });
});
