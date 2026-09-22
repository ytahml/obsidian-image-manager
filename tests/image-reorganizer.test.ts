import { describe, expect, it, vi } from "vitest";

vi.mock("obsidian", () => ({
    TFile: class TFile {},
    TFolder: class TFolder {},
    normalizePath: (path: string) =>
        path
            .replace(/\\/g, "/")
            .replace(/\/+/g, "/")
            .replace(/^\/+|\/+$/g, ""),
}));

import { TFile, TFolder, type App } from "obsidian";
import { DEFAULT_SETTINGS, type ImageManagerSettings } from "../src/types";
import { ImageReorganizer } from "../src/utils/image-reorganizer";

function file(path: string): TFile {
    const result = new TFile();
    setFilePath(result, path);
    return result;
}

function setFilePath(target: TFile, path: string): void {
    target.path = path;
    target.name = path.split("/").pop() ?? path;
    target.extension = target.name.split(".").pop() ?? "";
    const parentPath = path.slice(0, path.lastIndexOf("/"));
    target.parent = parentPath
        ? ({ path: parentPath } as TFile["parent"])
        : null;
}

function normalizeRelative(sourcePath: string, target: string): string {
    const parts = sourcePath
        .slice(0, sourcePath.lastIndexOf("/"))
        .split("/")
        .filter(Boolean);
    for (const part of target.split("/").filter(Boolean)) {
        if (part === "..") parts.pop();
        else if (part !== ".") parts.push(part);
    }
    return parts.join("/");
}

function createVault(
    orderedFiles: TFile[],
    initialContent: Record<string, string>,
) {
    const contents = new Map(Object.entries(initialContent));
    const folders = new Map<string, TFolder>();
    const rename = vi.fn(async (target: TFile, newPath: string) => {
        setFilePath(target, newPath);
    });
    const process = vi.fn(
        async (target: TFile, update: (content: string) => string) => {
            contents.set(target.path, update(contents.get(target.path) ?? ""));
        },
    );

    const getAbstractFileByPath = (path: string) =>
        orderedFiles.find((candidate) => candidate.path === path) ??
        folders.get(path) ??
        null;
    const metadataCache = {
        getFirstLinkpathDest: vi.fn((target: string, sourcePath: string) => {
            const direct = target.startsWith("/") ? target.slice(1) : target;
            const explicit = getAbstractFileByPath(direct);
            if (explicit instanceof TFile) return explicit;
            const relative = getAbstractFileByPath(
                normalizeRelative(sourcePath, target),
            );
            if (relative instanceof TFile) return relative;
            const name = target.split("/").pop() ?? target;
            const sameName = orderedFiles.filter(
                (candidate) => candidate.name === name,
            );
            return sameName.length === 1 ? sameName[0]! : null;
        }),
    };
    const app = {
        metadataCache,
        vault: {
            getFiles: () => orderedFiles,
            getMarkdownFiles: () =>
                orderedFiles.filter(
                    (candidate) => candidate.extension === "md",
                ),
            getAbstractFileByPath,
            cachedRead: vi.fn(
                async (target: TFile) => contents.get(target.path) ?? "",
            ),
            process,
            rename,
            createFolder: vi.fn(async (path: string) => {
                const folder = new TFolder();
                folder.path = path;
                folders.set(path, folder);
                return folder;
            }),
        },
    } as unknown as App;
    return { app, contents, rename, process };
}

function settings(
    overrides: Partial<ImageManagerSettings> = {},
): ImageManagerSettings {
    return {
        ...DEFAULT_SETTINGS,
        supportedExtensions: ["png", "jpg", "jpeg"],
        imagePathBase: "note",
        imagePathTemplate: "attachments",
        skipWikiRefsOnReorganize: true,
        ...overrides,
    };
}

function targetDirectory(_template: string, note: TFile | null): string {
    const parent = note?.parent?.path ?? "";
    return [parent, "attachments"].filter(Boolean).join("/");
}

describe("ImageReorganizer", () => {
    it.each([
        ["original order", false],
        ["reversed image order", true],
    ])(
        "keeps same-name Markdown images bound to their source notes (%s)",
        async (_label, reverseImages) => {
            const noteA = file("notes/A.md");
            const noteB = file("notes/B.md");
            const imageA = file("notes/src/A/image.jpg");
            const imageB = file("notes/src/B/image.jpg");
            const images = reverseImages ? [imageB, imageA] : [imageA, imageB];
            const { app, contents } = createVault([noteA, noteB, ...images], {
                [noteA.path]: "![](src/A/image.jpg)",
                [noteB.path]: "![](src/B/image.jpg)",
            });
            const reorganizer = new ImageReorganizer(
                app,
                settings(),
                targetDirectory,
            );

            await expect(
                reorganizer.reorganizeFolder("notes", "markdown"),
            ).resolves.toMatchObject({
                moved: 2,
                skipped: 0,
            });
            expect(imageA.path).toBe("notes/attachments/image.jpg");
            expect(imageB.path).toBe("notes/attachments/image-1.jpg");
            expect(contents.get(noteA.path)).toBe("![](attachments/image.jpg)");
            expect(contents.get(noteB.path)).toBe(
                "![](attachments/image-1.jpg)",
            );
        },
    );

    it("fails closed for an ambiguous short Markdown reference", async () => {
        const note = file("notes/current.md");
        const first = file("one/image.jpg");
        const second = file("two/image.jpg");
        const source = "![](image.jpg)";
        const { app, contents, rename, process } = createVault(
            [note, second, first],
            { [note.path]: source },
        );
        const reorganizer = new ImageReorganizer(
            app,
            settings(),
            targetDirectory,
        );

        await expect(
            reorganizer.reorganizeNote(note, "markdown"),
        ).resolves.toEqual({
            moved: 0,
            skipped: 1,
        });
        expect(contents.get(note.path)).toBe(source);
        expect(rename).not.toHaveBeenCalled();
        expect(process).not.toHaveBeenCalled();
    });

    it("updates only other notes pre-bound to the moved image", async () => {
        const noteA = file("notes/A.md");
        const shared = file("notes/shared.md");
        const unrelated = file("notes/B.md");
        const imageA = file("notes/src/A/image.jpg");
        const imageB = file("notes/src/B/image.jpg");
        const { app, contents } = createVault(
            [noteA, shared, unrelated, imageB, imageA],
            {
                [noteA.path]: "![](src/A/image.jpg)",
                [shared.path]: "![](src/A/image.jpg)",
                [unrelated.path]: "![](src/B/image.jpg)",
            },
        );
        const reorganizer = new ImageReorganizer(
            app,
            settings(),
            targetDirectory,
        );

        await expect(
            reorganizer.reorganizeNote(noteA, "markdown"),
        ).resolves.toEqual({
            moved: 1,
            skipped: 0,
        });
        expect(contents.get(noteA.path)).toBe("![](attachments/image.jpg)");
        expect(contents.get(shared.path)).toBe("![](attachments/image.jpg)");
        expect(contents.get(unrelated.path)).toBe("![](src/B/image.jpg)");
        expect(imageB.path).toBe("notes/src/B/image.jpg");
    });

    it("preserves Wiki references when configured to skip them", async () => {
        const note = file("notes/current.md");
        const image = file("notes/image.png");
        const source = "![[image.png]]";
        const { app, contents, rename } = createVault([note, image], {
            [note.path]: source,
        });
        const reorganizer = new ImageReorganizer(
            app,
            settings(),
            targetDirectory,
        );

        await expect(
            reorganizer.reorganizeNote(note, "markdown"),
        ).resolves.toEqual({
            moved: 0,
            skipped: 1,
        });
        expect(contents.get(note.path)).toBe(source);
        expect(rename).not.toHaveBeenCalled();
    });

    it("encodes a moved Unicode Markdown path when using a Vault-root target", async () => {
        const note = file("notes/current.md");
        const image = file("notes/source/中文 image.png");
        const source = "![封面](<source/%E4%B8%AD%E6%96%87%20image.png>)";
        const { app, contents } = createVault([note, image], {
            [note.path]: source,
        });
        const reorganizer = new ImageReorganizer(
            app,
            settings({ imagePathBase: "vault" }),
            () => "attachments",
        );

        await expect(
            reorganizer.reorganizeNote(note, "markdown"),
        ).resolves.toEqual({
            moved: 1,
            skipped: 0,
        });
        expect(image.path).toBe("attachments/中文 image.png");
        expect(contents.get(note.path)).toBe(
            "![封面](attachments/中文%20image.png)",
        );
    });

    it("keeps the original Wiki format when conversion is disabled", async () => {
        const note = file("notes/current.md");
        const image = file("notes/source/image.png");
        const source = "![[source/image.png|Cover]]";
        const { app, contents } = createVault([note, image], {
            [note.path]: source,
        });
        const reorganizer = new ImageReorganizer(
            app,
            settings({ skipWikiRefsOnReorganize: false }),
            targetDirectory,
        );

        await expect(reorganizer.reorganizeNote(note)).resolves.toEqual({
            moved: 1,
            skipped: 0,
        });
        expect(contents.get(note.path)).toBe("![[image.png|Cover]]");
    });
});
