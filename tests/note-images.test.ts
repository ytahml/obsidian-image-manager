import { describe, expect, it, vi } from 'vitest';

vi.mock('obsidian', () => ({
    MarkdownView: class MarkdownView {},
    TFile: class TFile {},
    normalizePath: (path: string) => path.replace(/^\/+|\/+$/g, ''),
}));

import { TFile, type App } from 'obsidian';
import { collectLocalNoteImages, resolveLocalImageReference } from '../src/uploaders/note-images';
import { readNoteContentForAction } from '../src/utils/note-content';
import type { RefConverter } from '../src/utils/ref-converter';

function createFile(path: string, parentPath = ''): TFile {
    const file = new TFile();
    file.path = path;
    file.name = path.split('/').pop() ?? path;
    file.parent = parentPath ? { path: parentPath } as TFile['parent'] : null;
    return file;
}

describe('note image upload references', () => {
    it('uses live editor text when the selected note is active', async () => {
        const read = vi.fn();
        const app = {
            workspace: {
                getActiveViewOfType: vi.fn(() => ({
                    file: { path: 'notes/current.md' },
                    editor: { getValue: () => '![live](image.png)' },
                })),
            },
            vault: { read },
        } as unknown as App;
        const file = createFile('notes/current.md');

        await expect(readNoteContentForAction(app, file)).resolves.toBe('![live](image.png)');
        expect(read).not.toHaveBeenCalled();
    });

    it('reads the saved file when the selected note is not active', async () => {
        const read = vi.fn(async () => '![saved](image.png)');
        const app = {
            workspace: {
                getActiveViewOfType: vi.fn(() => ({
                    file: { path: 'notes/other.md' },
                    editor: { getValue: () => '![other](image.png)' },
                })),
            },
            vault: { read },
        } as unknown as App;
        const file = createFile('notes/current.md');

        await expect(readNoteContentForAction(app, file)).resolves.toBe('![saved](image.png)');
        expect(read).toHaveBeenCalledWith(file);
    });

    it('reads live editor content and resolves a fully encoded Unicode path', async () => {
        const note = createFile('notes/current.md', 'notes');
        const image = createFile('notes/assets/中文 image.png', 'notes/assets');
        const getFirstLinkpathDest = vi.fn((path: string) => path === 'assets/中文 image.png' ? image : null);
        const read = vi.fn();
        const app = {
            workspace: {
                getActiveViewOfType: vi.fn(() => ({
                    file: note,
                    editor: { getValue: () => '![中文](assets/%E4%B8%AD%E6%96%87%20image.png)' },
                })),
            },
            metadataCache: { getFirstLinkpathDest },
            vault: {
                read,
                getAbstractFileByPath: vi.fn(),
                getFiles: vi.fn(() => [image]),
            },
        } as unknown as App;
        const refConverter = {
            parseReferences: vi.fn(() => [{
                fullMatch: '![中文](assets/%E4%B8%AD%E6%96%87%20image.png)',
                altText: '中文',
                path: 'assets/%E4%B8%AD%E6%96%87%20image.png',
                format: 'markdown',
                line: 0,
                col: 0,
            }]),
        } as unknown as RefConverter;

        const result = await collectLocalNoteImages(app, note, refConverter);

        expect(result.references).toHaveLength(1);
        expect(result.references[0]?.file).toBe(image);
        expect(getFirstLinkpathDest).toHaveBeenCalledWith('assets/中文 image.png', note.path);
        expect(read).not.toHaveBeenCalled();
    });

    it('unwraps angle-bracket destinations before resolving them', () => {
        const note = createFile('notes/current.md', 'notes');
        const image = createFile('assets/my image.png', 'assets');
        const app = {
            metadataCache: {
                getFirstLinkpathDest: vi.fn((path: string) => path === 'assets/my image.png' ? image : null),
            },
            vault: {
                getAbstractFileByPath: vi.fn(),
                getFiles: vi.fn(() => []),
            },
        } as unknown as App;

        expect(resolveLocalImageReference(app, note, '<assets/my%20image.png>')).toBe(image);
    });

    it('excludes every remote scheme, protocol-relative URL, data URL and blob URL', async () => {
        const note = createFile('notes/current.md', 'notes');
        const local = createFile('notes/local.png', 'notes');
        const paths = [
            'local.png',
            'HTTPS://cdn.example/image.png',
            '//cdn.example/image.png',
            'data:image/png;base64,abc',
            'blob:https://example.com/id',
        ];
        const app = {
            workspace: { getActiveViewOfType: vi.fn(() => null) },
            metadataCache: { getFirstLinkpathDest: vi.fn(() => local) },
            vault: {
                read: vi.fn(async () => 'content'),
                getAbstractFileByPath: vi.fn(),
                getFiles: vi.fn(() => [local]),
            },
        } as unknown as App;
        const refConverter = {
            parseReferences: vi.fn(() => paths.map((path, index) => ({
                fullMatch: `![${index}](${path})`,
                altText: String(index),
                path,
                format: 'markdown',
                line: 0,
                col: index,
            }))),
        } as unknown as RefConverter;

        const result = await collectLocalNoteImages(app, note, refConverter);

        expect(result.references.map((item) => item.reference.path)).toEqual(['local.png']);
    });
});
