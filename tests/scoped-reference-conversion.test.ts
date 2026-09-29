import { describe, expect, it, vi } from 'vitest';
vi.mock('obsidian', () => ({ MarkdownView: class MarkdownView {}, TFile: class TFile {} }));
import { MarkdownView, TFile, type App, type Editor } from 'obsidian';
import type { RefConverter } from '../src/utils/ref-converter';
import { ScopedReferenceConversion } from '../src/utils/scoped-reference-conversion';

function note(path: string): TFile {
    return Object.assign(new TFile(), { path });
}
function editor(initial: string): Editor & { value: string } {
    let value = initial;
    return {
        get value() { return value; },
        set value(next: string) { value = next; },
        getValue: () => value,
        offsetToPos: (offset: number) => ({ line: 0, ch: offset }),
        replaceRange: (replacement: string) => { value = replacement; },
    } as unknown as Editor & { value: string };
}
function fixture() {
    const notes = [note('a/one.md'), note('a/two.md'), note('ab/three.md')];
    const saved = new Map(notes.map(file => [file.path, '![[img.png]]']));
    const leaves: Array<{ view: MarkdownView }> = [];
    const app = {
        workspace: {
            getLeavesOfType: () => leaves,
            getActiveViewOfType: () => null,
        },
        vault: {
            getMarkdownFiles: () => notes,
            getAbstractFileByPath: (path: string) => notes.find(file => file.path === path) ?? null,
            read: vi.fn(async (file: TFile) => saved.get(file.path) ?? ''),
            process: vi.fn(async (file: TFile, update: (content: string) => string) => {
                saved.set(file.path, update(saved.get(file.path) ?? ''));
            }),
        },
    } as unknown as App;
    let onConvert: ((file: TFile) => void) | undefined;
    const converter = {
        convertAllReferences: (content: string, _format: string, file: TFile) => {
            onConvert?.(file);
            if (!content.includes('![[img.png]]')) return { content, converted: 0, skipped: 0 };
            return { content: content.replace('![[img.png]]', '![img](img.png)'), converted: 1, skipped: 0 };
        },
    } as unknown as RefConverter;
    const open = (file: TFile, value: Editor) => {
        leaves.push({ view: Object.assign(Object.create(MarkdownView.prototype), { file, editor: value }) as MarkdownView });
    };
    return { app, converter, notes, saved, leaves, open, setOnConvert: (value: (file: TFile) => void) => { onConvert = value; } };
}

describe('scoped reference conversion', () => {
    it('uses the selected note scope and writes live editor content instead of stale vault content', async () => {
        const f = fixture();
        const live = editor('prefix ![[img.png]]');
        f.saved.set(f.notes[0]!.path, 'stale saved content');
        f.open(f.notes[0]!, live);
        const result = await new ScopedReferenceConversion(f.app, f.converter).convert({ kind: 'note', path: f.notes[0]!.path });
        expect(live.value).toBe('prefix ![img](img.png)');
        expect(f.saved.get(f.notes[0]!.path)).toBe('stale saved content');
        expect(result).toMatchObject({ totalNotes: 1, convertedNotes: 1, convertedReferences: 1, conflicts: 0, failedNotes: 0 });
    });

    it('leaves conflicting editor content unchanged and continues with independent notes', async () => {
        const f = fixture();
        const first = editor('![[img.png]]');
        const second = editor('![[img.png]]');
        f.open(f.notes[0]!, first);
        f.setOnConvert(file => { if (file === f.notes[0]) first.value = 'changed while converting'; });
        const result = await new ScopedReferenceConversion(f.app, f.converter).convert({ kind: 'folder', path: 'a' });
        expect(first.value).toBe('changed while converting');
        expect(f.saved.get(f.notes[1]!.path)).toBe('![img](img.png)');
        expect(result).toMatchObject({ totalNotes: 2, convertedNotes: 1, convertedReferences: 1, conflicts: 1, failedNotes: 0 });
        expect(second.value).toBe('![[img.png]]');
    });

    it('fails closed when open editors disagree and when a note identity changes', async () => {
        const f = fixture();
        f.open(f.notes[0]!, editor('![[img.png]]'));
        f.open(f.notes[0]!, editor('different'));
        f.setOnConvert(file => {
            if (file === f.notes[1]) file.path = 'a/renamed.md';
        });
        const result = await new ScopedReferenceConversion(f.app, f.converter).convert({ kind: 'folder', path: 'a' });
        expect(result).toMatchObject({ convertedNotes: 0, convertedReferences: 0, conflicts: 1, failedNotes: 1 });
    });
});
