import { beforeEach, describe, expect, it, vi } from "vitest";
import { TFile, TFolder, type App } from "obsidian";

vi.mock("obsidian", () => ({
    TFile: class {},
    TFolder: class {},
    normalizePath: (path: string) =>
        path.replace(/\\/g, "/").replace(/^\/+|\/+$/g, ""),
}));

import { RefConverter } from "../src/utils/ref-converter";

function createConverter(
    files: Array<{ name: string; path: string }> = [],
    resolveLink: (path: string, sourcePath: string) => TFile | null = () =>
        null,
): RefConverter {
    const vaultFiles = files.map((input) => Object.assign(new TFile(), input));
    const app = {
        vault: {
            getFiles: () => vaultFiles,
        },
        metadataCache: {
            getFirstLinkpathDest: resolveLink,
        },
    } as unknown as App;
    return new RefConverter(app);
}

function createNote(path: string, parentPath: string): TFile {
    const parent = new TFolder();
    parent.path = parentPath;
    const note = new TFile();
    note.path = path;
    note.parent = parent;
    return note;
}

describe("RefConverter", () => {
    let converter: RefConverter;

    beforeEach(() => {
        converter = createConverter();
    });

    it("parses Markdown and Wiki references in source order with line numbers", () => {
        const refs = converter.parseReferences(
            "![cover](assets/a.png)\ntext\n![[b.jpg|Photo]]",
        );

        expect(refs).toMatchObject([
            {
                format: "markdown",
                altText: "cover",
                path: "assets/a.png",
                line: 0,
            },
            { format: "wiki", altText: "Photo", path: "b.jpg", line: 2 },
        ]);
        expect(refs[0]!.col).toBeLessThan(refs[1]!.col);
    });

    it("parses a table-escaped Wiki separator without adding the escape to the path", () => {
        expect(
            converter.parseReferences("![[assets/chart.png\\|140]]"),
        ).toMatchObject([
            { format: "wiki", path: "assets/chart.png", altText: "140" },
        ]);
        expect(
            converter.countReferences("![[assets/chart.png\\|140]]"),
        ).toEqual({
            markdown: 0,
            wiki: 1,
        });
    });

    it("does not leak global regular expression state between parses", () => {
        expect(converter.parseReferences("![[first.png]]")).toHaveLength(1);
        expect(converter.parseReferences("![[second.png]]")).toHaveLength(1);
    });

    it("counts both reference formats", () => {
        expect(
            converter.countReferences("![a](a.png) ![[b.png]] ![](c.jpg)"),
        ).toEqual({
            markdown: 2,
            wiki: 1,
        });
    });

    it.each([
        [
            "notes/blog",
            "assets/images/photo.png",
            "../../assets/images/photo.png",
        ],
        ["notes/blog", "notes/assets/photo.png", "../assets/photo.png"],
        ["", "assets/photo.png", "assets/photo.png"],
        ["notes", "notes", "notes"],
    ])("computes a relative path from %s to %s", (from, to, expected) => {
        expect(converter.computeRelativePath(from, to)).toBe(expected);
    });

    it("converts Markdown references to Wiki references and omits redundant alt text", () => {
        expect(
            converter.convertAllReferences(
                "![photo](assets/photo.png)",
                "wiki",
            ),
        ).toEqual({ content: "![[photo.png]]", converted: 1, skipped: 0 });
        expect(
            converter.convertAllReferences(
                "![Cover](assets/photo.png)",
                "wiki",
            ),
        ).toEqual({
            content: "![[photo.png|Cover]]",
            converted: 1,
            skipped: 0,
        });
    });

    it("resolves Wiki filenames and converts them relative to the note", () => {
        converter = createConverter([
            { name: "my photo.png", path: "assets/my photo.png" },
        ]);
        const note = createNote("notes/travel/day.md", "notes/travel");

        expect(
            converter.convertAllReferences(
                "![[my photo.png|Cover]]",
                "markdown",
                note,
            ),
        ).toEqual({
            content: "![Cover](../../assets/my%20photo.png)",
            converted: 1,
            skipped: 0,
        });
    });

    it("converts multiple references without corrupting later offsets", () => {
        expect(
            converter.convertAllReferences(
                "A ![one](a.png) B ![b](b.png)",
                "wiki",
            ),
        ).toEqual({
            content: "A ![[a.png|one]] B ![[b.png]]",
            converted: 2,
            skipped: 0,
        });
    });

    it("leaves references unchanged when already in the target format", () => {
        const source = "![[image.png|caption]]";
        expect(converter.convertAllReferences(source, "wiki")).toEqual({
            content: source,
            converted: 0,
            skipped: 0,
        });
    });

    it("keeps an ambiguous Wiki reference unchanged instead of choosing the first basename", () => {
        converter = createConverter([
            { name: "image.png", path: "one/image.png" },
            { name: "image.png", path: "two/image.png" },
        ]);
        const note = createNote("notes/current.md", "notes");
        const source = "![[image.png|caption]]";

        expect(
            converter.convertAllReferences(source, "markdown", note),
        ).toEqual({
            content: source,
            converted: 0,
            skipped: 1,
        });
    });
});
