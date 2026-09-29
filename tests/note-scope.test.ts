import { describe, expect, it, vi } from 'vitest';
vi.mock('obsidian', () => ({}));
import type { App, TFile } from 'obsidian';
import { getNotesInScope } from '../src/utils/note-scope';

const notes = [
    { path: 'a/one.md' },
    { path: 'a/sub/two.md' },
    { path: 'ab/three.md' },
    { path: 'root.md' },
] as TFile[];
const app = { vault: { getMarkdownFiles: () => notes } } as unknown as App;

describe('note scope', () => {
    it('selects the whole vault', () => {
        expect(getNotesInScope(app, { kind: 'vault' })).toEqual(notes);
    });
    it('selects one exact note and returns empty for a stale target', () => {
        expect(getNotesInScope(app, { kind: 'note', path: 'a/one.md' })).toEqual([notes[0]]);
        expect(getNotesInScope(app, { kind: 'note', path: 'missing.md' })).toEqual([]);
    });
    it('selects recursive folders without adjacent prefixes and treats root as all notes', () => {
        expect(getNotesInScope(app, { kind: 'folder', path: '/a/' })).toEqual([notes[0], notes[1]]);
        expect(getNotesInScope(app, { kind: 'folder', path: '' })).toEqual(notes);
    });
});
