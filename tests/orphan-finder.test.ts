import { describe, expect, it, vi } from 'vitest';

vi.mock('obsidian', () => ({
    TFile: class TFile {},
    normalizePath: (path: string) => path.replace(/\/+/g, '/'),
}));

import { TFile, type App } from 'obsidian';
import { OrphanFinder } from '../src/utils/orphan-finder';

function file(path: string, extension: string): TFile {
    const result = new TFile();
    result.path = path;
    result.name = path.split('/').pop()!;
    result.extension = extension;
    result.stat = { size: 1, ctime: 0, mtime: 0 };
    return result;
}

describe('OrphanFinder', () => {
    it('uses an active editor snapshot instead of stale vault text when deciding whether a local image is orphaned', async () => {
        const note = file('notes/example.md', 'md');
        const image = file('notes/example/image.png', 'png');
        const app = {
            vault: {
                getFiles: () => [note, image],
                getMarkdownFiles: () => [note],
                cachedRead: vi.fn().mockResolvedValue('![](example/image.png)'),
            },
        } as unknown as App;

        const result = await new OrphanFinder(app, ['png']).findOrphans(
            new Map([[note.path, '<img src="https://example.test/image.png">']])
        );

        expect(result.orphans).toEqual([image]);
    });

    it('keeps a local image when another note still references it after the source is replaced', async () => {
        const source = file('notes/source.md', 'md');
        const other = file('notes/other.md', 'md');
        const image = file('notes/image.png', 'png');
        const app = {
            vault: {
                getFiles: () => [source, other, image],
                getMarkdownFiles: () => [source, other],
                cachedRead: vi.fn(async (entry: TFile) => entry === source
                    ? '![image](https://example.test/image.png)'
                    : '![](image.png)'),
            },
        } as unknown as App;

        const result = await new OrphanFinder(app, ['png']).findOrphans();

        expect(result.orphans).toEqual([]);
    });
});
