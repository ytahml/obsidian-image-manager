import { describe, expect, it, vi } from 'vitest';

vi.mock('obsidian', () => ({
    App: class App {},
    TFile: class TFile {},
    normalizePath: (path: string) => path.replace(/^\/+|\/+$/g, ''),
}));

import { TFile, type App } from 'obsidian';
import { BatchRename } from '../src/utils/batch-rename';
import { DEFAULT_SETTINGS } from '../src/types';

function file(path: string): TFile {
    return Object.assign(new TFile(), {
        path, name: path.split('/').pop()!, extension: path.split('.').pop()!,
        parent: { path: path.substring(0, path.lastIndexOf('/')) },
    });
}

function fixture(initial: string, filename = 'photo.png') {
    const target = file(`a/${filename}`), other = file(`b/${filename}`), note = file('note.md');
    const files = [target, other, note];
    let content = initial;
    const rename = vi.fn(async (item: TFile, path: string) => {
        item.path = path;
        item.name = path.split('/').pop()!;
    });
    const app = {
        metadataCache: { getFirstLinkpathDest: () => null },
        vault: {
            getFiles: () => files, getMarkdownFiles: () => [note],
            getAbstractFileByPath: (path: string) => files.find(item => item.path === path),
            cachedRead: async () => content,
            process: async (_note: TFile, update: (text: string) => string) => { content = update(content); },
            rename,
        },
    } as unknown as App;
    return { app, target, other, rename, getContent: () => content };
}

describe('BatchRename explicit image rename', () => {
    it('updates only references to the target identity and preserves remote and ambiguous targets', async () => {
        const untouched = [
            '![](b/photo.png)', '![[b/photo.png|other]]',
            '![](https://cdn.example/photo.png)', '![](//cdn.example/photo.png)',
            '![](missing/photo.png)', '![[photo.png]]',
        ].join('\n');
        const f = fixture('![](a/photo.png)\n![[a/photo.png|target]]\n' + untouched);
        const result = await new BatchRename(f.app, DEFAULT_SETTINGS).renameImage(f.target, 'renamed.png');

        expect(f.getContent()).toBe('![](a/renamed.png)\n![[a/renamed.png|target]]\n' + untouched);
        expect(result.notesUpdated).toBe(1);
        expect(f.other.path).toBe('b/photo.png');
        expect(f.rename).toHaveBeenCalledWith(f.target, 'a/renamed.png');
    });

    it('honors authoritative source-note resolution of a short Wiki target', async () => {
        const f = fixture('![[photo.png|keep alt]]');
        f.app.metadataCache.getFirstLinkpathDest = () => f.target;
        await new BatchRename(f.app, DEFAULT_SETTINGS).renameImage(f.target, 'renamed.png');
        expect(f.getContent()).toBe('![[a/renamed.png|keep alt]]');
    });

    it('preserves Markdown encoding and Wiki literal filename semantics', async () => {
        const f = fixture('![](a/a%20b.png)\n![[a/a b.png]]\n![](b/a%20b.png)', 'a b.png');
        await new BatchRename(f.app, DEFAULT_SETTINGS).renameImage(f.target, 'new #.png');
        expect(f.getContent()).toBe('![](a/new%20%23.png)\n![[a/new #.png]]\n![](b/a%20b.png)');
    });
});
