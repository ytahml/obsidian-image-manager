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

    it("finds nested linked images and decodes Markdown punctuation escapes", async () => {
        const note = file("notes/example.md", "md");
        const linked = file("notes/assets/chart.png", "png");
        const referenceLinked = file(
            "notes/assets/reference-linked.png",
            "png",
        );
        const escaped = file("notes/assets/diagram (draft).png", "png");
        const app = appWith(
            {
                [note.path]: [
                    "[![chart](assets/chart.png)](https://example.org)",
                    "[![reference](assets/reference-linked.png)][dest]",
                    "[dest]: https://example.org",
                    "![draft](assets/diagram \\(draft\\).png)",
                ].join("\n"),
            },
            [note, linked, referenceLinked, escaped],
        );

        const index = await buildLocalReferenceIndex(app, ["png"]);
        expect(index.indeterminate).toEqual([]);
        expect(index.occurrencesByImagePath.has(linked.path)).toBe(true);
        expect(index.occurrencesByImagePath.has(referenceLinked.path)).toBe(
            true,
        );
        expect(index.occurrencesByImagePath.has(escaped.path)).toBe(true);
    });

    it("keeps quoted frontmatter and HTML entity paths with URL suffixes", async () => {
        const note = file("notes/example.md", "md");
        const image = file("notes/assets/my chart.svg", "svg");
        const plain = file("notes/assets/plain chart.svg", "svg");
        const app = appWith(
            {
                [note.path]: [
                    "---",
                    'cover: "assets/my chart.svg"',
                    "thumbnail: assets/plain chart.svg",
                    "---",
                    '<img src="assets/my&#32;chart.svg#layer">',
                ].join("\n"),
            },
            [note, image, plain],
        );

        const index = await buildLocalReferenceIndex(app, ["svg"]);
        expect(index.indeterminate).toEqual([]);
        expect(index.occurrencesByImagePath.get(image.path)).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ kind: "frontmatter" }),
                expect.objectContaining({ kind: "html" }),
            ]),
        );
        expect(index.occurrencesByImagePath.get(plain.path)).toMatchObject([
            { kind: "frontmatter", sourcePath: note.path },
        ]);
    });

    it("decodes each HTML entity exactly once", async () => {
        const note = file("notes/example.md", "md");
        const image = file("notes/assets/&quot;.png", "png");
        const app = appWith(
            { [note.path]: '<img src="assets/&#38;quot;.png">' },
            [note, image],
        );

        const index = await buildLocalReferenceIndex(app, ["png"]);
        expect(index.indeterminate).toEqual([]);
        expect(index.occurrencesByImagePath.get(image.path)).toMatchObject([
            { kind: "html", sourcePath: note.path },
        ]);
    });

    it("keeps a local srcset candidate after a descriptor-free data URL", async () => {
        const note = file("notes/example.md", "md");
        const image = file("notes/assets/chart.png", "png");
        const app = appWith(
            {
                [note.path]:
                    '<img srcset="data:image/png;base64,AAAA, assets/chart.png 2x">',
            },
            [note, image],
        );

        const index = await buildLocalReferenceIndex(app, ["png"]);
        expect(index.indeterminate).toEqual([]);
        expect(index.occurrencesByImagePath.get(image.path)).toMatchObject([
            { kind: "html", sourcePath: note.path },
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

    it("keeps Canvas file-node paths literal while decoding text-node Markdown paths", async () => {
        const canvas = file("maps/diagram.canvas", "canvas");
        const literal = file("maps/assets/chart%20draft.png", "png");
        const markdown = file("maps/assets/chart draft.png", "png");
        const app = appWith(
            {
                [canvas.path]: JSON.stringify({
                    nodes: [
                        { type: "file", file: "assets/chart%20draft.png" },
                        {
                            type: "text",
                            text: "![chart](assets/chart%20draft.png)",
                        },
                    ],
                }),
            },
            [canvas, literal, markdown],
        );

        const index = await buildLocalReferenceIndex(app, ["png"]);
        expect(index.indeterminate).toEqual([]);
        expect(index.occurrencesByImagePath.has(literal.path)).toBe(true);
        expect(index.occurrencesByImagePath.has(markdown.path)).toBe(true);
    });

    it("marks every image indeterminate when a Canvas file cannot be parsed", async () => {
        const canvas = file("maps/damaged.canvas", "canvas");
        const first = file("assets/first.png", "png");
        const second = file("assets/second.png", "png");
        const app = appWith({ [canvas.path]: '{"nodes":[{"type":"file"' }, [
            canvas,
            first,
            second,
        ]);

        const index = await buildLocalReferenceIndex(app, ["png"]);
        expect(index.occurrencesByImagePath).toEqual(new Map());
        expect(index.indeterminate).toEqual([first, second]);
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
