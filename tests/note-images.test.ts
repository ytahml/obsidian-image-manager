import { describe, expect, it, vi } from 'vitest';

vi.mock('obsidian', () => ({
    MarkdownView: class MarkdownView {},
    TFile: class TFile {},
    normalizePath: (path: string) => path.replace(/^\/+|\/+$/g, ''),
}));

import { TFile, type App } from 'obsidian';
import { collectLocalNoteImages, resolveLocalImageReference } from '../src/uploaders/note-images';
import type { RefConverter } from '../src/utils/ref-converter';

function createFile(path: string, parentPath = ''): TFile {
    const file = new TFile();
    file.path = path;
    file.name = path.split('/').pop() ?? path;
    file.parent = parentPath ? { path: parentPath } as TFile['parent'] : null;
    return file;
}

describe('note image upload references', () => {
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
});
