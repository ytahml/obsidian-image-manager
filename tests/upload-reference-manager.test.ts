import { describe, expect, it, vi } from "vitest";

vi.mock("obsidian", () => ({
    TFile: class TFile {},
    MarkdownView: class MarkdownView {},
    normalizePath: (path: string) => path.replace(/^\/+|\/+$/g, ""),
}));

import { MarkdownView, TFile, type App, type Editor } from "obsidian";
import type { RefConverter } from "../src/utils/ref-converter";
import { UploadReferenceManager } from "../src/uploaders/upload-reference-manager";

function imageFile(path: string): TFile {
    const file = new TFile();
    file.path = path;
    file.name = path.split("/").pop() ?? path;
    file.extension = path.split(".").pop() ?? "";
    file.stat = { mtime: 1, ctime: 1, size: 10 };
    const parentPath = path.slice(0, path.lastIndexOf("/"));
    file.parent = parentPath ? ({ path: parentPath } as TFile["parent"]) : null;
    return file;
}

describe("UploadReferenceManager", () => {
    it("prepares one reusable custom-reference renderer and reads requested dimensions once", async () => {
        const file = imageFile("assets/Cover.PNG");
        const getImageInfo = vi.fn(async () => ({ width: 640, height: 480 }));
        const manager = new UploadReferenceManager({
            app: {} as App,
            refConverter: {} as RefConverter,
            getDefaultTemplate: () =>
                '<img src="{fileUrl}" alt="{fileAlt}" width="{fileWidth}">',
            getImageInfo,
        });

        const prepared = await manager.prepare(file);

        expect(
            prepared.render(
                "https://cdn.example/%E4%B8%AD%E6%96%87.png",
                "封面",
            ),
        ).toBe(
            '<img src="https://cdn.example/中文.png" alt="封面" width="640">',
        );
        expect(prepared.render("https://cdn.example/other.png")).toContain(
            'alt="Cover"',
        );
        expect(getImageInfo).toHaveBeenCalledTimes(1);
    });

    it("does not replace another note reference that resolves to a different same-name image", async () => {
        const uploaded = imageFile("one/photo.png");
        const otherImage = imageFile("two/photo.png");
        const source = imageFile("one/source.md");
        const otherNote = imageFile("two/note.md");
        const match = "![](photo.png)";
        const contents = new Map([[otherNote.path, match]]);
        const process = vi.fn(
            async (file: TFile, update: (content: string) => string) => {
                contents.set(file.path, update(contents.get(file.path) ?? ""));
            },
        );
        const app = {
            workspace: { getLeavesOfType: () => [], getActiveViewOfType: () => null },
            metadataCache: {
                getFirstLinkpathDest: vi.fn(
                    (target: string, sourcePath: string) =>
                        target === "photo.png" && sourcePath === otherNote.path
                            ? otherImage
                            : null,
                ),
            },
            vault: {
                getFiles: () => [uploaded, otherImage, source, otherNote],
                getMarkdownFiles: () => [source, otherNote],
                getAbstractFileByPath: (path: string) => [uploaded, otherImage, source, otherNote].find(file => file.path === path),
                read: async (file: TFile) => contents.get(file.path) ?? "",
                cachedRead: async (file: TFile) =>
                    contents.get(file.path) ?? "",
                process,
            },
        } as unknown as App;
        const manager = new UploadReferenceManager({
            app,
            refConverter: {
                parseReferences: vi.fn((content: string) =>
                    content === match
                        ? [
                              {
                                  fullMatch: match,
                                  path: "photo.png",
                                  altText: "",
                                  format: "markdown",
                                  line: 0,
                                  col: 0,
                              },
                          ]
                        : [],
                ),
            } as unknown as RefConverter,
            getDefaultTemplate: () => "",
            getImageInfo: vi.fn(),
        });
        const prepared = await manager.prepare(uploaded);

        await expect(
            manager.replaceVaultReferences(
                uploaded,
                "https://cdn.example/new.png",
                prepared,
                { skipFile: source },
            ),
        ).resolves.toBe(0);

        expect(contents.get(otherNote.path)).toBe(match);
        expect(process).not.toHaveBeenCalled();
    });

    it("replaces matching local references, skips remote references and the requested note", async () => {
        const image = imageFile("assets/photo.png");
        const current = imageFile("notes/current.md");
        const other = imageFile("notes/other.md");
        const skipped = imageFile("notes/skipped.md");
        const contents = new Map([
            [
                current.path,
                "![local](assets/photo.png) ![remote](https://cdn.example/photo.png)",
            ],
            [other.path, "![[photo.png|wiki]]"],
            [skipped.path, "![skip](assets/photo.png)"],
        ]);
        const process = vi.fn(
            async (file: TFile, update: (content: string) => string) => {
                contents.set(file.path, update(contents.get(file.path) ?? ""));
            },
        );
        const parseReferences = vi.fn((content: string) => {
            const refs: Array<{
                fullMatch: string;
                path: string;
                altText: string;
                col: number;
            }> = [];
            const patterns = [
                {
                    fullMatch: "![local](assets/photo.png)",
                    path: "assets/photo.png",
                    altText: "local",
                    format: "markdown",
                },
                {
                    fullMatch: "![remote](https://cdn.example/photo.png)",
                    path: "https://cdn.example/photo.png",
                    altText: "remote",
                    format: "markdown",
                },
                {
                    fullMatch: "![[photo.png|wiki]]",
                    path: "photo.png",
                    altText: "wiki",
                    format: "wiki",
                },
                {
                    fullMatch: "![skip](assets/photo.png)",
                    path: "assets/photo.png",
                    altText: "skip",
                    format: "markdown",
                },
            ];
            for (const pattern of patterns) {
                const col = content.indexOf(pattern.fullMatch);
                if (col >= 0) refs.push({ ...pattern, col });
            }
            return refs;
        });
        const app = {
            workspace: { getLeavesOfType: () => [], getActiveViewOfType: () => null },
            vault: {
                getFiles: () => [image, current, other, skipped],
                getMarkdownFiles: () => [current, other, skipped],
                getAbstractFileByPath: (path: string) => [image, current, other, skipped].find(file => file.path === path),
                read: async (file: TFile) => contents.get(file.path) ?? "",
                cachedRead: async (file: TFile) =>
                    contents.get(file.path) ?? "",
                process,
            },
        } as unknown as App;
        const manager = new UploadReferenceManager({
            app,
            refConverter: { parseReferences } as unknown as RefConverter,
            getDefaultTemplate: () => "",
            getImageInfo: vi.fn(),
        });
        const prepared = await manager.prepare(image);

        await expect(
            manager.replaceVaultReferences(
                image,
                "https://cdn.example/new.png",
                prepared,
                { skipFile: skipped },
            ),
        ).resolves.toBe(2);

        expect(contents.get(current.path)).toBe(
            "![local](https://cdn.example/new.png) ![remote](https://cdn.example/photo.png)",
        );
        expect(contents.get(other.path)).toBe(
            "![wiki](https://cdn.example/new.png)",
        );
        expect(contents.get(skipped.path)).toBe("![skip](assets/photo.png)");
        expect(process).toHaveBeenCalledTimes(2);
    });

    it.each([false, true])('preserves concurrent edits during automatic writeback (open editor: %s)', async (open) => {
        const image = imageFile('assets/photo.png');
        const note = imageFile('note.md');
        const original = '![](assets/photo.png)';
        let content = original;
        const replaceRange = vi.fn((text: string) => { content = text; });
        const editor = {
            getValue: () => content,
            offsetToPos: (offset: number) => ({ line: 0, ch: offset }),
            replaceRange,
        } as unknown as Editor;
        const leaves = open ? [{ view: Object.assign(Object.create(MarkdownView.prototype) as MarkdownView, { file: note, editor }) }] : [];
        const app = {
            workspace: { getLeavesOfType: () => leaves, getActiveViewOfType: () => null },
            vault: {
                getFiles: () => [image, note], getMarkdownFiles: () => [note],
                getAbstractFileByPath: (path: string) => [image, note].find(file => file.path === path),
                read: async () => content, cachedRead: async () => content,
                process: async (_file: TFile, update: (text: string) => string) => {
                    content += '\nUSER_EDIT';
                    content = update(content);
                },
            },
        } as unknown as App;
        const manager = new UploadReferenceManager({
            app,
            refConverter: { parseReferences: () => [{ fullMatch: original, path: image.path, format: 'markdown', col: 0, altText: '' }] } as unknown as RefConverter,
            getDefaultTemplate: () => '', getImageInfo: vi.fn(),
        });
        const prepared = { render: () => {
            if (open) content += '\nUSER_EDIT';
            return '![](https://cdn.example/new.png)';
        } };

        expect(await manager.replaceVaultReferences(image, 'https://cdn.example/new.png', prepared)).toBe(0);
        expect(content).toBe(original + '\nUSER_EDIT');
        expect(replaceRange).not.toHaveBeenCalled();
    });

    it('updates unsaved content through its editor without writing the stale saved note', async () => {
        const image = imageFile('assets/photo.png'), note = imageFile('note.md');
        let content = 'UNSAVED\n![](assets/photo.png)';
        const editor = {
            getValue: () => content, offsetToPos: (offset: number) => ({ line: 0, ch: offset }),
            replaceRange: (text: string) => { content = text; },
        } as unknown as Editor;
        const process = vi.fn();
        const app = {
            workspace: { getLeavesOfType: () => [{ view: Object.assign(Object.create(MarkdownView.prototype) as MarkdownView, { file: note, editor }) }], getActiveViewOfType: () => null },
            vault: {
                getFiles: () => [image, note], getMarkdownFiles: () => [note],
                getAbstractFileByPath: (path: string) => [image, note].find(file => file.path === path),
                cachedRead: async () => '![](assets/photo.png)', read: async () => '![](assets/photo.png)', process,
            },
        } as unknown as App;
        const manager = new UploadReferenceManager({
            app,
            refConverter: { parseReferences: (text: string) => [{ fullMatch: '![](assets/photo.png)', path: image.path, format: 'markdown', col: text.indexOf('![]'), altText: '' }] } as unknown as RefConverter,
            getDefaultTemplate: () => '', getImageInfo: vi.fn(),
        });
        const prepared = await manager.prepare(image);
        expect(await manager.replaceVaultReferences(image, 'https://cdn.example/new.png', prepared)).toBe(1);
        expect(content).toBe('UNSAVED\n![photo](https://cdn.example/new.png)');
        expect(process).not.toHaveBeenCalled();
    });
});
