import { describe, expect, it, vi } from 'vitest';

vi.mock('obsidian', () => ({
    App: class App {},
    MarkdownView: class MarkdownView {},
    TFile: class TFile {},
    normalizePath: (path: string) => path.replace(/^\/+|\/+$/g, ''),
}));

import { MarkdownView, TFile, type App, type Editor } from 'obsidian';
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
    const views: MarkdownView[] = [];
    const app = {
        workspace: { getLeavesOfType: () => views.map(view => ({ view })), getActiveViewOfType: () => null },
        metadataCache: { getFirstLinkpathDest: () => null },
        vault: {
            getFiles: () => files, getMarkdownFiles: () => [note],
            getAbstractFileByPath: (path: string) => files.find(item => item.path === path),
            cachedRead: async () => content,
            read: async () => content,
            process: async (_note: TFile, update: (text: string) => string) => { content = update(content); },
            rename,
        },
    } as unknown as App;
    return { app, target, other, note, views, rename, getContent: () => content, setContent: (value: string) => { content = value; } };
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

    it('preserves a concurrent disk edit and stops before renaming on conflict', async () => {
        const f = fixture('![](a/photo.png)');
        f.app.vault.process = async (_file, update) => {
            f.setContent(f.getContent() + '\nnew user text');
            f.setContent(update(f.getContent()));
            return f.getContent();
        };
        await expect(new BatchRename(f.app, DEFAULT_SETTINGS).renameImage(f.target, 'renamed.png')).rejects.toThrow();
        expect(f.getContent()).toBe('![](a/photo.png)\nnew user text');
        expect(f.rename).not.toHaveBeenCalled();
    });

    it('updates live editor contents including unsaved text', async () => {
        const f = fixture('![](a/photo.png)');
        let text = '![](a/photo.png)\nunsaved text';
        const editor = { getValue: () => text, offsetToPos: () => ({ line: 1, ch: 12 }),
            replaceRange: (value: string) => { text = value; } } as unknown as Editor;
        f.views.push(Object.assign(Object.create(MarkdownView.prototype) as MarkdownView, { file: f.note, editor }));
        await new BatchRename(f.app, DEFAULT_SETTINGS).renameImage(f.target, 'renamed.png');
        expect(text).toBe('![](a/renamed.png)\nunsaved text');
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
