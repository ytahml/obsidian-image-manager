import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TFile, TFolder, type App } from 'obsidian';

vi.mock('obsidian', () => ({
    TFile: class {},
    TFolder: class {},
}));

import { RefConverter } from '../src/utils/ref-converter';

function createConverter(files: Array<{ name: string; path: string }> = []): RefConverter {
    const app = {
        vault: {
            getFiles: () => files,
        },
    } as unknown as App;
    return new RefConverter(app);
}

function createNote(path: string, parentPath: string): TFile {
    const parent = new TFolder();
    parent.path = parentPath;
    const note = new TFile();
    note.path = path;
    note.parent = parent;
    return note;
}

describe('RefConverter', () => {
    let converter: RefConverter;

    beforeEach(() => {
        converter = createConverter();
    });

    it('parses Markdown and Wiki references in source order with line numbers', () => {
        const refs = converter.parseReferences('![cover](assets/a.png)\ntext\n![[b.jpg|Photo]]');

        expect(refs).toMatchObject([
            { format: 'markdown', altText: 'cover', path: 'assets/a.png', line: 0 },
            { format: 'wiki', altText: 'Photo', path: 'b.jpg', line: 2 },
        ]);
        expect(refs[0]!.col).toBeLessThan(refs[1]!.col);
    });

    it('does not leak global regular expression state between parses', () => {
        expect(converter.parseReferences('![[first.png]]')).toHaveLength(1);
        expect(converter.parseReferences('![[second.png]]')).toHaveLength(1);
    });

    it('counts both reference formats', () => {
        expect(converter.countReferences('![a](a.png) ![[b.png]] ![](c.jpg)')).toEqual({
            markdown: 2,
            wiki: 1,
        });
    });

    it.each([
        ['notes/blog', 'assets/images/photo.png', '../../assets/images/photo.png'],
        ['notes/blog', 'notes/assets/photo.png', '../assets/photo.png'],
        ['', 'assets/photo.png', 'assets/photo.png'],
        ['notes', 'notes', 'notes'],
    ])('computes a relative path from %s to %s', (from, to, expected) => {
        expect(converter.computeRelativePath(from, to)).toBe(expected);
    });

    it('converts Markdown references to Wiki references and omits redundant alt text', () => {
        expect(converter.convertAllReferences('![photo](assets/photo.png)', 'wiki')).toBe('![[photo.png]]');
        expect(converter.convertAllReferences('![Cover](assets/photo.png)', 'wiki')).toBe(
            '![[photo.png|Cover]]'
        );
    });

    it('resolves Wiki filenames and converts them relative to the note', () => {
        converter = createConverter([{ name: 'my photo.png', path: 'assets/my photo.png' }]);
        const note = createNote('notes/travel/day.md', 'notes/travel');

        expect(converter.convertAllReferences('![[my photo.png|Cover]]', 'markdown', note)).toBe(
            '![Cover](../../assets/my%20photo.png)'
        );
    });

    it('converts multiple references without corrupting later offsets', () => {
        expect(converter.convertAllReferences('A ![one](a.png) B ![b](b.png)', 'wiki')).toBe(
            'A ![[a.png|one]] B ![[b.png]]'
        );
    });

    it('leaves references unchanged when already in the target format', () => {
        const source = '![[image.png|caption]]';
        expect(converter.convertAllReferences(source, 'wiki')).toBe(source);
    });
});
