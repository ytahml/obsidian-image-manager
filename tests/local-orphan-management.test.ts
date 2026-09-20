import { describe, expect, it, vi } from "vitest";

vi.mock("obsidian", () => ({
    MarkdownView: class MarkdownView {},
    TFile: class TFile {},
    normalizePath: (path: string) =>
        path.replace(/\\/g, "/").replace(/\/+/g, "/"),
}));

import { TFile, type App } from "obsidian";
import type { OrphanResult } from "../src/utils/orphan-finder";
import {
    filterLocalImagesByReferenceState,
    getLocalReferenceState,
    scanLocalOrphans,
    trashValidatedLocalOrphans,
    validateLocalOrphanSelection,
} from "../src/utils/local-orphan-management";

function image(path: string, size = 10): TFile {
    const file = new TFile();
    file.path = path;
    file.name = path.split("/").pop()!;
    file.extension = file.name.split(".").pop()!;
    file.parent = {
        path: path.slice(0, path.lastIndexOf("/")),
    } as TFile["parent"];
    file.stat = { size, ctime: 0, mtime: 0 };
    return file;
}

function result(orphans: TFile[]): OrphanResult {
    return { orphans, indeterminate: [], total: orphans.length, referenced: 0 };
}

describe("local orphan management", () => {
    it("maps scan lifecycle and orphan membership to conservative card states", () => {
        const paths = new Set(["orphan.png"]);
        expect(getLocalReferenceState("orphan.png", null, "scanning")).toBe(
            "scanning",
        );
        expect(getLocalReferenceState("orphan.png", null, "failed")).toBe(
            "unknown",
        );
        expect(getLocalReferenceState("orphan.png", paths, "ready")).toBe(
            "orphan",
        );
        expect(getLocalReferenceState("referenced.png", paths, "ready")).toBe(
            "referenced",
        );
        expect(
            getLocalReferenceState(
                "changing.png",
                paths,
                "ready",
                new Set(["changing.png"]),
            ),
        ).toBe("unknown");
    });

    it("filters the complete local result by referenced or orphan state", () => {
        const images = [
            { path: "referenced.png" },
            { path: "orphan.png" },
            { path: "nested/orphan.webp" },
        ];
        const orphanPaths = new Set(["orphan.png", "nested/orphan.webp"]);

        expect(
            filterLocalImagesByReferenceState(images, orphanPaths, "all"),
        ).toEqual(images);
        expect(
            filterLocalImagesByReferenceState(
                images,
                orphanPaths,
                "referenced",
                new Set(["referenced.png"]),
            ),
        ).toEqual([]);
        expect(
            filterLocalImagesByReferenceState(
                images,
                orphanPaths,
                "referenced",
            ),
        ).toEqual([{ path: "referenced.png" }]);
        expect(
            filterLocalImagesByReferenceState(images, orphanPaths, "orphan"),
        ).toEqual([{ path: "orphan.png" }, { path: "nested/orphan.webp" }]);
    });

    it("preserves parser unknowns while adding lifecycle protection", async () => {
        const note = image("notes/example.md");
        const first = image("one/chart.png");
        const second = image("two/chart.png");
        const changing = image("changing.png");
        const files = [note, first, second, changing];
        const app = {
            metadataCache: { getFirstLinkpathDest: () => null },
            vault: {
                cachedRead: async (file: TFile) =>
                    file.path === note.path ? "![[chart.png]]" : "",
                getAbstractFileByPath: (path: string) =>
                    files.find((file) => file.path === path) ?? null,
                getFiles: () => files,
            },
            workspace: { getLeavesOfType: () => [] },
        } as unknown as App;

        await expect(
            scanLocalOrphans(app, ["png"], new Map(), new Set([changing.path])),
        ).resolves.toEqual({
            orphans: [],
            indeterminate: [first, second, changing],
            total: 3,
            referenced: 0,
        });
    });

    it("only validates files that remain orphaned in the fresh result", () => {
        const current = image("current.png");
        expect(
            validateLocalOrphanSelection(
                new Set(["current.png", "now-referenced.png", "missing.png"]),
                result([current]),
            ),
        ).toEqual({
            eligible: [current],
            skippedPaths: ["now-referenced.png", "missing.png"],
        });
    });

    it("never trashes an image that a fresh scan marks indeterminate", async () => {
        const uncertain = image("diagram.png");
        const trashFile = vi.fn();
        const app = { fileManager: { trashFile } } as unknown as App;

        await expect(
            trashValidatedLocalOrphans(
                app,
                new Set([uncertain.path]),
                vi.fn().mockResolvedValue({
                    orphans: [],
                    indeterminate: [uncertain],
                    total: 1,
                    referenced: 0,
                } satisfies OrphanResult),
            ),
        ).resolves.toEqual({
            deletedPaths: [],
            skippedPaths: [uncertain.path],
            failedPaths: [],
        });
        expect(trashFile).not.toHaveBeenCalled();
    });

    it("rescans before trashing and reports deleted, skipped, and failed paths", async () => {
        const deleted = image("deleted.png");
        const failed = image("failed.png");
        const error = new Error("Trash failed");
        const trashFile = vi.fn(async (file: TFile) => {
            if (file.path === failed.path) throw error;
        });
        const warn = vi
            .spyOn(console, "error")
            .mockImplementation(() => undefined);
        const app = { fileManager: { trashFile } } as unknown as App;

        await expect(
            trashValidatedLocalOrphans(
                app,
                new Set(["deleted.png", "failed.png", "now-referenced.png"]),
                vi.fn().mockResolvedValue(result([deleted, failed])),
            ),
        ).resolves.toEqual({
            deletedPaths: ["deleted.png"],
            skippedPaths: ["now-referenced.png"],
            failedPaths: ["failed.png"],
        });
        expect(trashFile).toHaveBeenCalledTimes(2);
        expect(warn).toHaveBeenCalledWith(
            "[ImageManager] Failed to trash orphan image failed.png:",
            error,
        );
        warn.mockRestore();
    });
});
