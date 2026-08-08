import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('obsidian', () => ({
    App: class App {},
    TFile: class TFile {},
}));

vi.mock('../src/utils/ref-converter', () => ({
    RefConverter: class RefConverter {
        parseReferences(content: string) {
            const fullMatch = '![](foo.png)';
            return content.includes(fullMatch)
                ? [{ fullMatch, altText: '', path: 'foo.png', format: 'markdown', line: 0, col: content.indexOf(fullMatch) }]
                : [];
        }
        computeRelativePath(_from: string, to: string) { return to; }
    },
}));

import { TFile, type App } from 'obsidian';
import { BatchRename } from '../src/utils/batch-rename';
import type { ImageManagerSettings } from '../src/types';

describe('BatchRename broken reference repair', () => {
    let note: TFile;
    let content: string;
    let process: ReturnType<typeof vi.fn>;
    let app: App;

    beforeEach(() => {
        note = new TFile();
        note.path = 'note.md';
        note.parent = null;
        const firstTarget = new TFile();
        firstTarget.path = 'x/foo.png';
        const secondTarget = new TFile();
        secondTarget.path = 'y/foo.png';
        const targets = new Map([[firstTarget.path, firstTarget], [secondTarget.path, secondTarget]]);
        content = '![](foo.png)';
        process = vi.fn(async (_file: TFile, update: (current: string) => string) => { content = update(content); });
        app = {
            vault: {
                getMarkdownFiles: () => [note],
                cachedRead: async () => content,
                process,
                getAbstractFileByPath: (path: string) => targets.get(path) ?? null,
            },
            metadataCache: { getFirstLinkpathDest: () => null },
        } as unknown as App;
    });

    it('fails closed when two rename entries could explain the same broken basename', async () => {
        const rename = new BatchRename(app, { imagePathBase: 'vault' } as ImageManagerSettings);

        await expect(rename.fixBrokenImageRefsBatch([
            { oldPath: 'a/foo.png', newPath: 'x/foo.png' },
            { oldPath: 'b/foo.png', newPath: 'y/foo.png' },
        ])).resolves.toBe(0);

        expect(content).toBe('![](foo.png)');
        expect(process).not.toHaveBeenCalled();
    });

    it('repairs a basename only when one batch entry uniquely explains it', async () => {
        const rename = new BatchRename(app, { imagePathBase: 'vault' } as ImageManagerSettings);

        await expect(rename.fixBrokenImageRefsBatch([
            { oldPath: 'a/foo.png', newPath: 'x/foo.png' },
        ])).resolves.toBe(1);

        expect(content).toBe('![](x/foo.png)');
        expect(process).toHaveBeenCalledTimes(1);
    });
});
