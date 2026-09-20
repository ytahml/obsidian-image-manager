import { describe, expect, it, vi } from "vitest";

vi.mock("obsidian", () => ({
    TFile: class TFile {},
    normalizePath: (path: string) => path.replace(/\/+/g, "/"),
}));

import { TFile, type App } from "obsidian";
import { OrphanFinder } from "../src/utils/orphan-finder";

function file(path: string, extension: string): TFile {
    const result = new TFile();
    result.path = path;
    result.name = path.split("/").pop()!;
    result.extension = extension;
    result.stat = { size: 1, ctime: 0, mtime: 0 };
    return result;
}

describe("OrphanFinder", () => {
    it("uses an active editor snapshot instead of stale vault text when deciding whether a local image is orphaned", async () => {
        const note = file("notes/example.md", "md");
        const image = file("notes/example/image.png", "png");
        const app = {
            vault: {
                getFiles: () => [note, image],
                getMarkdownFiles: () => [note],
                cachedRead: vi.fn().mockResolvedValue("![](example/image.png)"),
            },
        } as unknown as App;

        const result = await new OrphanFinder(app, ["png"]).findOrphans(
            new Map([
                [note.path, '<img src="https://example.test/image.png">'],
            ]),
        );

        expect(result.orphans).toEqual([image]);
    });

    it("keeps a local image when another note still references it after the source is replaced", async () => {
        const source = file("notes/source.md", "md");
        const other = file("notes/other.md", "md");
        const image = file("notes/image.png", "png");
        const app = {
            vault: {
                getFiles: () => [source, other, image],
                getMarkdownFiles: () => [source, other],
                cachedRead: vi.fn(async (entry: TFile) =>
                    entry === source
                        ? "![image](https://example.test/image.png)"
                        : "![](image.png)",
                ),
            },
        } as unknown as App;

        const result = await new OrphanFinder(app, ["png"]).findOrphans();

        expect(result.orphans).toEqual([]);
    });

    it("keeps a table image whose wiki embed escapes its sizing separator", async () => {
        const note = file("notes/lesson.md", "md");
        const image = file("notes/assets/chart.png", "png");
        const app = {
            vault: {
                getFiles: () => [note, image],
                getMarkdownFiles: () => [note],
                cachedRead: vi
                    .fn()
                    .mockResolvedValue("| ![[assets/chart.png\\|140]] |"),
            },
        } as unknown as App;

        const finder = new OrphanFinder(app, ["png"]);
        await expect(finder.findOrphans()).resolves.toMatchObject({
            orphans: [],
            referenced: 1,
        });
        await expect(finder.getReferencingNotes(image)).resolves.toEqual([
            { path: note.path, lines: [0] },
        ]);
    });

    it("keeps an Excalidraw embedded-file image recorded as a regular wiki link", async () => {
        const drawing = file("Excalidraw/example.md", "md");
        const image = file("Excalidraw/assets/chart.png", "png");
        const app = {
            vault: {
                getFiles: () => [drawing, image],
                getMarkdownFiles: () => [drawing],
                cachedRead: vi
                    .fn()
                    .mockResolvedValue(
                        "## Embedded Files\n\nabc123: [[assets/chart.png]]",
                    ),
            },
        } as unknown as App;

        const finder = new OrphanFinder(app, ["png"]);
        await expect(finder.findOrphans()).resolves.toMatchObject({
            orphans: [],
            referenced: 1,
        });
        await expect(finder.getReferencingNotes(image)).resolves.toEqual([
            { path: drawing.path, lines: [2] },
        ]);
    });
});
