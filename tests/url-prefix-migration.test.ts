import { describe, expect, it, vi } from 'vitest';
vi.mock('obsidian', () => ({ MarkdownView: class MarkdownView {}, TFile: class TFile {} }));
import { MarkdownView, TFile, type App, type Editor } from 'obsidian';
import {
    applyUrlReplacements,
    findUrlPrefixReplacements,
    nextPreviousUrlPrefix,
    resolveMigrationFromBase,
    UrlPrefixMigration,
} from '../src/remote/url-prefix-migration';

describe('findUrlPrefixReplacements', () => {
    it('rewrites a markdown image URL under the old base and preserves the key', () => {
        const content = '![](https://a.example.com/obs-notes/2026/08/x.webp)';
        const result = findUrlPrefixReplacements(content, 'https://a.example.com', 'https://b.example.com');
        expect(result).toHaveLength(1);
        expect(result[0]!.original).toBe('https://a.example.com/obs-notes/2026/08/x.webp');
        expect(result[0]!.replacement).toBe('https://b.example.com/obs-notes/2026/08/x.webp');
        expect(applyUrlReplacements(content, result)).toBe('![](https://b.example.com/obs-notes/2026/08/x.webp)');
    });

    it('rejects a host that only shares a suffix', () => {
        expect(findUrlPrefixReplacements('https://a.example.com.evil.com/x.webp', 'https://a.example.com', 'https://b.example.com')).toHaveLength(0);
    });

    it('rejects a path prefix that shares a segment prefix', () => {
        expect(findUrlPrefixReplacements('https://a.example.com/obs-notes2/x.webp', 'https://a.example.com/obs-notes', 'https://b.example.com')).toHaveLength(0);
    });

    it('matches a base with a directory path and keeps the remaining key', () => {
        const result = findUrlPrefixReplacements('https://a.example.com/obs-notes/x.webp', 'https://a.example.com/obs-notes', 'https://b.example.com/bucket');
        expect(result[0]!.replacement).toBe('https://b.example.com/bucket/x.webp');
    });

    it('preserves query and fragment', () => {
        const result = findUrlPrefixReplacements('https://a.example.com/x.webp?sig=abc#frag', 'https://a.example.com', 'https://b.example.com');
        expect(result[0]!.replacement).toBe('https://b.example.com/x.webp?sig=abc#frag');
    });

    it('keeps trailing punctuation in the original text', () => {
        const content = '(https://a.example.com/x.webp).';
        const result = findUrlPrefixReplacements(content, 'https://a.example.com', 'https://b.example.com');
        expect(applyUrlReplacements(content, result)).toBe('(https://b.example.com/x.webp).');
    });

    it('normalizes a scheme-less base', () => {
        const result = findUrlPrefixReplacements('https://a.example.com/x.webp', 'a.example.com', 'b.example.com');
        expect(result[0]!.replacement).toBe('https://b.example.com/x.webp');
    });

    it('returns nothing for empty or equal bases', () => {
        expect(findUrlPrefixReplacements('https://a.example.com/x.webp', '', 'https://b.example.com')).toHaveLength(0);
        expect(findUrlPrefixReplacements('https://a.example.com/x.webp', 'https://a.example.com', 'https://a.example.com')).toHaveLength(0);
    });

    it('applies multiple matches from back to front', () => {
        const content = 'a https://a.example.com/1.webp b https://a.example.com/2.webp c';
        const result = findUrlPrefixReplacements(content, 'https://a.example.com', 'https://b.example.com');
        expect(result).toHaveLength(2);
        expect(applyUrlReplacements(content, result)).toBe('a https://b.example.com/1.webp b https://b.example.com/2.webp c');
    });

    it('rewrites adjacent markdown image references without merging them', () => {
        const content = '![a.jpg](https://s3.vkfc.dpdns.org/obs-notes/2026/10/1.jpg)![b.jpg|700](https://s3.vkfc.dpdns.org/obs-notes/2026/10/2.jpg)111';
        const result = findUrlPrefixReplacements(content, 's3.vkfc.dpdns.org', 's3.lunak.cn');
        expect(result).toHaveLength(2);
        expect(applyUrlReplacements(content, result)).toBe('![a.jpg](https://s3.lunak.cn/obs-notes/2026/10/1.jpg)![b.jpg|700](https://s3.lunak.cn/obs-notes/2026/10/2.jpg)111');
    });

    it('keeps an image title untouched while rewriting only the URL', () => {
        const content = '![图片](https://a.example.com/obs/a.jpg "图片标题")';
        const result = findUrlPrefixReplacements(content, 'https://a.example.com', 'https://b.example.com');
        expect(result).toHaveLength(1);
        expect(applyUrlReplacements(content, result)).toBe('![图片](https://b.example.com/obs/a.jpg "图片标题")');
    });

    it('rewrites an angle-bracket wrapped URL and keeps the brackets and title', () => {
        const content = '![alt](<https://a.example.com/obs/a.jpg> "标题")';
        const result = findUrlPrefixReplacements(content, 'https://a.example.com', 'https://b.example.com');
        expect(result).toHaveLength(1);
        expect(applyUrlReplacements(content, result)).toBe('![alt](<https://b.example.com/obs/a.jpg> "标题")');
    });

    it('rewrites a plain link URL and keeps its title', () => {
        const content = '[查看图片](https://a.example.com/obs/a.jpg "图片标题")';
        const result = findUrlPrefixReplacements(content, 'https://a.example.com', 'https://b.example.com');
        expect(result).toHaveLength(1);
        expect(applyUrlReplacements(content, result)).toBe('[查看图片](https://b.example.com/obs/a.jpg "图片标题")');
    });

    it('preserves parentheses in angle-wrapped image and link URLs', () => {
        const content = '![图](<https://a.example.com/obs/a(b).svg> "标题")[查看](  <https://a.example.com/obs/c(d).svg?q=(x)#part> "链接")';
        const result = findUrlPrefixReplacements(content, 'https://a.example.com/obs', 'https://longer.example.com/new-path');
        expect(result).toHaveLength(2);
        expect(applyUrlReplacements(content, result)).toBe('![图](<https://longer.example.com/new-path/a(b).svg> "标题")[查看](  <https://longer.example.com/new-path/c(d).svg?q=(x)#part> "链接")');
    });

    it('preserves HTML image attributes and quotes', () => {
        const content = `<img src="https://a.example.com/obs/a.svg" alt="图片" width="260"><img src='https://a.example.com/obs/b.svg' alt="单引号">`;
        const result = findUrlPrefixReplacements(content, 'https://a.example.com/obs', 'https://b.example.com/new');
        expect(result).toHaveLength(2);
        expect(applyUrlReplacements(content, result)).toBe(`<img src="https://b.example.com/new/a.svg" alt="图片" width="260"><img src='https://b.example.com/new/b.svg' alt="单引号">`);
    });

    it('rewrites an adjacent link and image without overlapping ranges', () => {
        const content = '[查看图片](https://a.example.com/obs/a.jpg)![图片](https://a.example.com/obs/b.jpg)';
        const result = findUrlPrefixReplacements(content, 'https://a.example.com', 'https://b.example.com');
        expect(result).toHaveLength(2);
        expect(applyUrlReplacements(content, result)).toBe('[查看图片](https://b.example.com/obs/a.jpg)![图片](https://b.example.com/obs/b.jpg)');
    });

    it('rewrites references separated by newlines', () => {
        const content = '[查看](https://a.example.com/obs/a.jpg)\n![图](https://a.example.com/obs/b.jpg)';
        const result = findUrlPrefixReplacements(content, 'https://a.example.com', 'https://b.example.com');
        expect(result).toHaveLength(2);
        expect(applyUrlReplacements(content, result)).toBe('[查看](https://b.example.com/obs/a.jpg)\n![图](https://b.example.com/obs/b.jpg)');
    });
});

describe('url prefix save state', () => {
    it('prefers the persisted previous base over the current-session original', () => {
        expect(resolveMigrationFromBase('s3.current.example.com', 's3.old.example.com')).toBe('s3.old.example.com');
        expect(resolveMigrationFromBase('', 's3.old.example.com')).toBe('s3.old.example.com');
        expect(resolveMigrationFromBase('s3.current.example.com', undefined)).toBe('s3.current.example.com');
        expect(resolveMigrationFromBase('', undefined)).toBe('');
    });

    it('tracks the previous base across a clear-then-refill sequence', () => {
        // Save 1: original A -> empty. Persist A.
        const persisted = nextPreviousUrlPrefix('s3.old.example.com', undefined);
        expect(persisted).toBe('s3.old.example.com');

        // Save 2: original empty -> B. Resolve persisted A as the old base.
        const from = resolveMigrationFromBase('', persisted);
        expect(from).toBe('s3.old.example.com');
        expect(nextPreviousUrlPrefix('', persisted)).toBe('s3.old.example.com');
    });
});

describe('UrlPrefixMigration', () => {
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
        const notes = [note('a/one.md'), note('a/two.md')];
        const saved = new Map(notes.map(file => [file.path, '![](https://a.example.com/x.webp)']));
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
        const open = (file: TFile, value: Editor) => {
            leaves.push({ view: Object.assign(Object.create(MarkdownView.prototype), { file, editor: value }) as MarkdownView });
        };
        return { app, notes, saved, leaves, open };
    }

    it('previews matching notes and reference counts', async () => {
        const f = fixture();
        const plan = await new UrlPrefixMigration(f.app).preview({ kind: 'folder', path: 'a' }, 'https://a.example.com', 'https://b.example.com');
        expect(plan).toMatchObject({ totalNotes: 2, referenceCount: 2 });
        expect(plan.notePaths).toEqual(['a/one.md', 'a/two.md']);
    });

    it('migrates notes with a snapshot write and reports the result', async () => {
        const f = fixture();
        const migration = new UrlPrefixMigration(f.app);
        const plan = await migration.preview({ kind: 'folder', path: 'a' }, 'https://a.example.com', 'https://b.example.com');
        const result = await migration.migrate(plan);
        expect(result).toMatchObject({ totalNotes: 2, migratedNotes: 2, migratedReferences: 2, conflicts: 0, failedNotes: 0 });
        expect(f.saved.get('a/one.md')).toBe('![](https://b.example.com/x.webp)');
        expect(f.saved.get('a/two.md')).toBe('![](https://b.example.com/x.webp)');
    });

    it('leaves conflicting editor content unchanged and continues with independent notes', async () => {
        const f = fixture();
        const live = editor('prefix ![](https://a.example.com/x.webp)');
        f.saved.set('a/one.md', 'stale saved content');
        f.open(f.notes[0]!, live);
        const migration = new UrlPrefixMigration(f.app);
        const plan = await migration.preview({ kind: 'folder', path: 'a' }, 'https://a.example.com', 'https://b.example.com');
        // A second editor disagrees before the write: readNoteSnapshot must fail closed.
        f.open(f.notes[0]!, editor('different'));
        const result = await migration.migrate(plan);
        expect(f.saved.get('a/two.md')).toBe('![](https://b.example.com/x.webp)');
        expect(f.saved.get('a/one.md')).toBe('stale saved content');
        expect(result).toMatchObject({ migratedNotes: 1, migratedReferences: 1, failedNotes: 1 });
    });

    it('reports a note that disappears before execution', async () => {
        const f = fixture();
        const migration = new UrlPrefixMigration(f.app);
        const plan = await migration.preview({ kind: 'folder', path: 'a' }, 'https://a.example.com', 'https://b.example.com');
        f.notes.splice(1, 1);
        const result = await migration.migrate(plan);
        expect(result).toMatchObject({ migratedNotes: 1, failedNotes: 1 });
    });

    it('guards against concurrent migrations', async () => {
        const f = fixture();
        const migration = new UrlPrefixMigration(f.app);
        const plan = await migration.preview({ kind: 'folder', path: 'a' }, 'https://a.example.com', 'https://b.example.com');
        const first = migration.migrate(plan);
        await expect(migration.migrate(plan)).rejects.toThrow('A URL prefix migration is already running');
        await first;
    });
});
