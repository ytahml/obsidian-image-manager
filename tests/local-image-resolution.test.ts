import { describe, expect, it, vi } from "vitest";

vi.mock("obsidian", () => ({
    TFile: class TFile {},
    normalizePath: (path: string) =>
        path
            .replace(/\\/g, "/")
            .replace(/^\/+|\/+$/g, "")
            .replace(/\/+/g, "/"),
}));

import { TFile, type App } from "obsidian";
import {
    createLocalFileLookup,
    resolveLocalFileReference,
} from "../src/utils/local-image-resolution";

function file(
    path: string,
    parentPath = path.slice(0, path.lastIndexOf("/")),
): TFile {
    const result = new TFile();
    result.path = path;
    result.name = path.split("/").pop() ?? path;
    result.extension = result.name.split(".").pop() ?? "";
    result.parent = parentPath
        ? ({ path: parentPath } as TFile["parent"])
        : null;
    return result;
}

function app(
    resolve: (path: string, sourcePath: string) => TFile | null = () => null,
): App {
    return {
        metadataCache: { getFirstLinkpathDest: vi.fn(resolve) },
    } as unknown as App;
}

describe("local image resolution", () => {
    it("uses Obsidian source-note semantics after decoding a Markdown destination", () => {
        const note = file("notes/current.md", "notes");
        const image = file("notes/assets/中文 image.png");
        const resolve = vi.fn((path: string, sourcePath: string) =>
            path === "assets/中文 image.png" && sourcePath === note.path
                ? image
                : null,
        );

        expect(
            resolveLocalFileReference(
                app(resolve),
                note,
                "<assets/%E4%B8%AD%E6%96%87%20image.png>",
                "markdown",
                createLocalFileLookup([image]),
            ),
        ).toEqual({ status: "resolved", file: image });
        expect(resolve).toHaveBeenCalledWith(
            "assets/中文 image.png",
            note.path,
        );
    });

    it("classifies an angle-bracket remote Markdown destination before lookup", () => {
        const note = file("notes/current.md", "notes");
        const local = file("assets/photo.png");
        const resolve = vi.fn(() => local);

        expect(
            resolveLocalFileReference(
                app(resolve),
                note,
                "<https://example.com/photo.png>",
                "markdown",
                createLocalFileLookup([local]),
            ),
        ).toEqual({ status: "remote" });
        expect(resolve).not.toHaveBeenCalled();
    });

    it("falls back to an explicit source-relative path", () => {
        const note = file("notes/daily/current.md", "notes/daily");
        const image = file("notes/assets/photo.png");

        expect(
            resolveLocalFileReference(
                app(),
                note,
                "../assets/photo.png",
                "markdown",
                createLocalFileLookup([image]),
            ),
        ).toEqual({ status: "resolved", file: image });
    });

    it("reports conflicting Vault-root and source-relative paths as ambiguous", () => {
        const note = file("notes/current.md", "notes");
        const vaultRoot = file("assets/photo.png");
        const sourceRelative = file("notes/assets/photo.png");

        expect(
            resolveLocalFileReference(
                app(),
                note,
                "assets/photo.png",
                "markdown",
                createLocalFileLookup([vaultRoot, sourceRelative]),
            ),
        ).toEqual({
            status: "ambiguous",
            candidates: [vaultRoot, sourceRelative],
        });
    });

    it("uses a basename fallback only when exactly one candidate exists", () => {
        const note = file("notes/current.md", "notes");
        const image = file("assets/photo.png");

        expect(
            resolveLocalFileReference(
                app(),
                note,
                "photo.png",
                "wiki",
                createLocalFileLookup([image]),
            ),
        ).toEqual({ status: "resolved", file: image });
    });

    it("returns every sorted candidate for an ambiguous basename regardless of input order", () => {
        const note = file("notes/current.md", "notes");
        const first = file("one/photo.png");
        const second = file("two/photo.png");
        const resolve = (files: TFile[]) =>
            resolveLocalFileReference(
                app(),
                note,
                "photo.png",
                "markdown",
                createLocalFileLookup(files),
            );

        expect(resolve([second, first])).toEqual({
            status: "ambiguous",
            candidates: [first, second],
        });
        expect(resolve([first, second])).toEqual({
            status: "ambiguous",
            candidates: [first, second],
        });
    });

    it("rejects an Obsidian result outside the eligible candidate set", () => {
        const note = file("notes/current.md", "notes");
        const unsupported = file("assets/photo.pdf");

        expect(
            resolveLocalFileReference(
                app(() => unsupported),
                note,
                "photo.pdf",
                "wiki",
                createLocalFileLookup([]),
            ),
        ).toEqual({ status: "missing" });
    });
});
