import { describe, expect, it, vi } from "vitest";

vi.mock("obsidian", () => ({
    TFile: class TFile {},
    normalizePath: (path: string) =>
        path.replace(/\\/g, "/").replace(/\/+/g, "/"),
}));

import { TFile, type App } from "obsidian";
import { buildLocalReferenceIndex } from "../src/utils/local-reference-index";

function file(path: string, extension: string): TFile {
    const target = new TFile();
    target.path = path;
    target.name = path.split("/").pop()!;
    target.extension = extension;
    target.parent = {
        path: path.slice(0, path.lastIndexOf("/")),
    } as TFile["parent"];
    return target;
}

function appWith(contents: Record<string, string>, files: TFile[]): App {
    return {
        vault: {
            getFiles: () => files,
            cachedRead: vi.fn(
                async (entry: TFile) => contents[entry.path] ?? "",
            ),
        },
    } as unknown as App;
}

describe("local reference index", () => {
    it("resolves Markdown, reference-style, HTML, frontmatter, and Wiki image uses without treating remote URLs as local", async () => {
        const note = file("notes/example.md", "md");
        const image = file("notes/assets/chart.png", "png");
        const app = appWith(
            {
                [note.path]: [
                    "---",
                    "cover: assets/chart.png",
                    "---",
                    "![inline](assets/chart.png)",
                    "[linked][chart]",
                    "[chart]: assets/chart.png",
                    '<img src="assets/chart.png" srcset="data:image/svg+xml,%3Csvg%3E 1x, assets/chart.png 2x, https://example.test/remote.png 3x">',
                    "![[assets/chart.png\\|140]]",
                ].join("\n"),
            },
            [note, image],
        );

        const index = await buildLocalReferenceIndex(app, ["png"]);
        expect(index.indeterminate).toEqual([]);
        expect(index.occurrencesByImagePath.get(image.path)).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ kind: "frontmatter" }),
                expect.objectContaining({ kind: "markdown" }),
                expect.objectContaining({ kind: "html" }),
                expect.objectContaining({ kind: "wiki" }),
            ]),
        );
    });

    it("keeps Markdown links with brackets in alt text and parentheses in a path", async () => {
        const note = file("notes/example.md", "md");
        const image = file("notes/assets/diagram (draft).png", "png");
        const app = appWith(
            {
                [note.path]: "![Diagram [draft]](assets/diagram (draft).png)",
            },
            [note, image],
        );

        const index = await buildLocalReferenceIndex(app, ["png"]);
        expect(index.indeterminate).toEqual([]);
        expect(index.occurrencesByImagePath.get(image.path)).toMatchObject([
            { kind: "markdown", sourcePath: note.path },
        ]);
    });

    it("indexes Canvas file nodes and text-node image links", async () => {
        const canvas = file("maps/diagram.canvas", "canvas");
        const image = file("maps/assets/chart.png", "png");
        const app = appWith(
            {
                [canvas.path]: JSON.stringify({
                    nodes: [
                        { type: "file", file: "assets/chart.png" },
                        { type: "text", text: '<img src="assets/chart.png">' },
                    ],
                }),
            },
            [canvas, image],
        );

        const index = await buildLocalReferenceIndex(app, ["png"]);
        expect(index.indeterminate).toEqual([]);
        expect(index.occurrencesByImagePath.get(image.path)).toMatchObject([
            { kind: "canvas", sourcePath: canvas.path },
            { kind: "canvas", sourcePath: canvas.path },
        ]);
    });

    it("protects every same-name candidate when a short link is ambiguous", async () => {
        const note = file("notes/example.md", "md");
        const first = file("one/chart.png", "png");
        const second = file("two/chart.png", "png");
        const app = appWith({ [note.path]: "![[chart.png]]" }, [
            note,
            first,
            second,
        ]);

        const index = await buildLocalReferenceIndex(app, ["png"]);
        expect(index.occurrencesByImagePath).toEqual(new Map());
        expect(index.indeterminate).toEqual([first, second]);
    });
});
