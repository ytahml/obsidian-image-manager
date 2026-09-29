import { describe, expect, it, vi } from 'vitest';
vi.mock('obsidian', () => ({
    TFile: class TFile {}, MarkdownView: class MarkdownView {},
    normalizePath: (path: string) => path,
}));
import { TFile, type App } from 'obsidian';
import { createUploadPlan } from '../src/uploaders/upload-scope';
import type { RefConverter } from '../src/utils/ref-converter';

function file(path: string): TFile {
    return Object.assign(new TFile(), { path, name: path.split('/').pop(), extension: path.split('.').pop(), stat: { mtime: 1, size: 10 } });
}
function fixture() {
    const notes = [file('a/one.md'), file('a/sub/two.md'), file('ab/three.md')];
    const image = file('elsewhere/shared.png');
    const orphan = file('a/orphan.png');
    const app = {
        workspace: { getActiveViewOfType: () => null, getLeavesOfType: () => [] },
        metadataCache: { getFirstLinkpathDest: () => image },
        vault: { getMarkdownFiles: () => notes, getFiles: () => [...notes, image, orphan],
            getAbstractFileByPath: (path: string) => [...notes, image, orphan].find(f => f.path === path),
            read: vi.fn(async () => '![[shared.png]]') },
    } as unknown as App;
    const converter = { parseReferences: () => [{ path: 'shared.png', format: 'wiki', fullMatch: '![[shared.png]]', col: 0, line: 0 }] } as unknown as RefConverter;
    return { app, converter, notes, image };
}
describe('upload scope', () => {
    it('selects descendant notes, not image directories or adjacent prefixes, and deduplicates', async () => {
        const { app, converter, image } = fixture();
        const plan = await createUploadPlan(app, converter, { kind: 'folder', path: 'a' }, ['png']);
        expect(plan.notes.map(n => n.path)).toEqual(['a/one.md', 'a/sub/two.md']);
        expect(plan.sources.map(s => s.file)).toEqual([image]);
    });
    it('supports vault and one note without uploading orphans', async () => {
        const { app, converter, notes } = fixture();
        const all = await createUploadPlan(app, converter, { kind: 'vault' }, ['png']);
        const one = await createUploadPlan(app, converter, { kind: 'note', path: notes[1]!.path }, ['png']);
        expect(all.notes).toHaveLength(3);
        expect(all.sources).toHaveLength(1);
        expect(one.notes).toEqual([notes[1]]);
    });
    it('returns an empty plan for a missing note', async () => {
        const { app, converter } = fixture();
        const plan = await createUploadPlan(app, converter, { kind: 'note', path: 'missing.md' }, ['png']);
        expect(plan.sources).toEqual([]);
    });
    it('reports unsupported files without scheduling upload', async () => {
        const { app, converter } = fixture();
        const plan = await createUploadPlan(app, converter, { kind: 'vault' }, ['jpg']);
        expect(plan.sources).toHaveLength(0);
        expect(plan.skipped).toHaveLength(3);
    });
});
