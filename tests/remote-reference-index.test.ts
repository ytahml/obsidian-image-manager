import { describe, expect, it, vi } from 'vitest';

vi.mock('obsidian', () => ({
    App: class {},
    TFile: class {},
    MarkdownView: class {},
}));

import { MarkdownView, TFile, type App, type Editor } from 'obsidian';
import {
    createRemoteObjectReferenceLookup,
    indexRemoteReference,
    type IndexedRemoteReference,
} from '../src/remote/object-reference-matcher';
import { RemoteReferenceIndex } from '../src/remote/reference-index';
import type { RemoteObject, RemoteUrlMapping } from '../src/remote/types';

const mapping: RemoteUrlMapping = {
    hostingId: 'hosting-a',
    urlPrefix: 'https://cdn.example.com/vault-a/',
    publicUrlAliases: ['https://origin.example.com/bucket/vault-a/'],
    ignoredQueryParameters: ['token', 'X-Amz-Signature'],
};

function object(key: string, hostingId = 'hosting-a'): RemoteObject {
    return { hostingId, key, size: 0 };
}

function reference(url: string, kind: IndexedRemoteReference['kind']): IndexedRemoteReference {
    const indexed = indexRemoteReference(url, kind);
    if (!indexed) throw new Error(`Expected valid URL: ${url}`);
    return indexed;
}

describe('remote object reference matcher', () => {
    it('matches normalized primary and alias URLs without basename guessing', () => {
        const lookup = createRemoteObjectReferenceLookup(mapping, [
            reference('HTTPS://CDN.EXAMPLE.COM:443/vault-a/nested/%E4%B8%AD%E6%96%87%20image.png#preview', 'markdown-image'),
            reference('https://origin.example.com/bucket/vault-a/nested/other.png', 'url'),
        ], { isComplete: true });

        expect(lookup.classify(object('nested/中文 image.png'))).toBe('referenced');
        expect(lookup.classify(object('nested/other.png'))).toBe('referenced');
        expect(lookup.classify(object('other.png'))).toBe('not-referenced-in-current-vault');
        expect(lookup.classify(object('nested/other.png', 'other-hosting'))).toBe('unmappable');
    });

    it('keeps encoded slashes and double-encoded percent values distinct', () => {
        const lookup = createRemoteObjectReferenceLookup(mapping, [
            reference('https://cdn.example.com/vault-a/a%2Fb.png', 'markdown-image'),
            reference('https://cdn.example.com/vault-a/file%2520name.png', 'markdown-image'),
        ], { isComplete: true });

        expect(lookup.classify(object('a%2Fb.png'))).toBe('referenced');
        expect(lookup.classify(object('a/b.png'))).toBe('not-referenced-in-current-vault');
        expect(lookup.classify(object('file%20name.png'))).toBe('referenced');
        expect(lookup.classify(object('file name.png'))).toBe('not-referenced-in-current-vault');
    });

    it('treats a mapped URL as referenced regardless of syntax or query parameters', () => {
        const lookup = createRemoteObjectReferenceLookup(mapping, [
            reference('https://cdn.example.com/vault-a/private.png?token=secret', 'url'),
        ], { isComplete: true });

        expect(lookup.classify(object('private.png'))).toBe('referenced');
        expect(lookup.classify(object('another.png'))).toBe('not-referenced-in-current-vault');

        const malformed = createRemoteObjectReferenceLookup(mapping, [
            reference('https://cdn.example.com/vault-a/broken%ZZ.png', 'url'),
        ], { isComplete: true });
        expect(malformed.classify(object('another.png'))).toBe('unmappable');
    });

    it('accepts explicitly ignored query names and rejects path-prefix lookalikes', () => {
        const lookup = createRemoteObjectReferenceLookup(mapping, [
            reference('https://cdn.example.com/vault-a/image%23%3F%25%28x%29.png?token=secret', 'markdown-image'),
            reference('https://cdn.example.com/vault-a-extra/not-a-match.png', 'markdown-image'),
        ], { isComplete: true });

        expect(lookup.classify(object('image#?%(x).png'))).toBe('referenced');
        expect(lookup.classify(object('not-a-match.png'))).toBe('not-referenced-in-current-vault');
    });

    it('does not declare objects unreferenced before a complete index exists', () => {
        const lookup = createRemoteObjectReferenceLookup(mapping, [], { isComplete: false });

        expect(lookup.classify(object('image.png'))).toBe('unmappable');
    });

    it('keeps query parameter names but never query values in indexed references', () => {
        const indexed = reference(
            'https://cdn.example.com/vault-a/image.png?token=secret-value&X-Amz-Signature=signature-value',
            'url'
        );

        expect([...indexed.queryParameterNames]).toEqual(['token', 'X-Amz-Signature']);
        expect(JSON.stringify(indexed)).not.toContain('secret-value');
        expect(JSON.stringify(indexed)).not.toContain('signature-value');
    });
});

interface TestFile {
    path: string;
    extension: string;
}

function createIndex(
    contents: Record<string, string>,
    now = () => 12345
) {
    const files = Object.keys(contents).map((path) => Object.assign(new TFile(), {
        path, extension: 'md', stat: { mtime: 1, ctime: 1, size: contents[path]!.length },
    }));
    const views: MarkdownView[] = [];
    let onRead: (() => void) | undefined;
    const read = async (file: TestFile) => { onRead?.(); return contents[file.path] ?? ''; };
    const app = {
        workspace: { getLeavesOfType: () => views.map(view => ({ view })), getActiveViewOfType: () => null },
        vault: {
            getMarkdownFiles: () => files,
            getAbstractFileByPath: (path: string) => files.find(file => file.path === path),
            read, cachedRead: read,
        },
    } as unknown as App;
    const refConverter = {
        parseReferences(text: string) {
            const match = /!\[[^\]]*\]\(([^)]+)\)/g;
            const references: Array<{
                format: 'markdown'; path: string; line: number; col: number; fullMatch: string;
            }> = [];
            let result: RegExpExecArray | null;
            while ((result = match.exec(text)) !== null) {
                references.push({
                    format: 'markdown',
                    path: result[1] ?? '',
                    line: text.slice(0, result.index).split('\n').length - 1,
                    col: result.index,
                    fullMatch: result[0],
                });
            }
            return references;
        },
    } as unknown as import('../src/utils/ref-converter').RefConverter;

    return {
        index: new RemoteReferenceIndex(app, refConverter, now),
        views, files,
        setOnRead(callback: () => void) { onRead = callback; },
        open(path: string, value: string) {
            const content = { value };
            const editor = { getValue: () => content.value } as Editor;
            const view = Object.assign(Object.create(MarkdownView.prototype) as MarkdownView, { file: files.find(file => file.path === path)!, editor });
            views.push(view);
            return { content, view };
        },
        setContent(path: string, content: string) {
            contents[path] = content;
        },
    };
}

describe('remote reference index', () => {
    it('treats every reliably mapped URL syntax as referenced and records its location', async () => {
        const { index } = createIndex({
            'one.md': [
                '![image](https://cdn.example.com/vault-a/definite.png)',
                '<img src="https://cdn.example.com/vault-a/html.png?token=secret">',
                '[plain](https://cdn.example.com/vault-a/link.png)',
                'https://cdn.example.com/vault-a/raw.png',
                '![[local.png]]',
                '![angle](<https://cdn.example.com/vault-a/angle.png>)',
            ].join('\n'),
            'two.md': 'https://outside.example.com/image.png',
        });

        await expect(index.scan()).resolves.toEqual({
            scannedAt: 12345,
            markdownFileCount: 2,
            referencedCount: 6,
            possiblyReferencedCount: 0,
            unmappableCount: 0,
        });

        const lookup = index.createLookup(mapping);
        expect(lookup.classify(object('definite.png'))).toBe('referenced');
        expect(lookup.classify(object('html.png'))).toBe('referenced');
        expect(lookup.classify(object('link.png'))).toBe('referenced');
        expect(lookup.classify(object('raw.png'))).toBe('referenced');
        expect(lookup.classify(object('angle.png'))).toBe('referenced');
        expect(lookup.getReferences(object('html.png'))).toEqual([{
            path: 'one.md', line: 1, syntax: 'url',
        }]);
        expect(lookup.classify(object('local.png'))).toBe('not-referenced-in-current-vault');
        expect(index.getState()).toMatchObject({ status: 'fresh' });
    });

    it('marks a completed snapshot stale without rescanning after a Vault change', async () => {
        const { index } = createIndex({ 'one.md': 'https://cdn.example.com/vault-a/image.png' });

        await index.scan();
        index.invalidate();

        expect(index.getState()).toMatchObject({ status: 'stale' });
        expect(index.createLookup(mapping).classify(object('image.png'))).toBe('unmappable');
    });

    it('does not publish a snapshot when aborted or invalidated during the scan', async () => {
        const controller = new AbortController();
        controller.abort();
        const { index } = createIndex({ 'one.md': 'https://cdn.example.com/vault-a/image.png' });

        await expect(index.scan({ signal: controller.signal })).rejects.toThrow('aborted');
        expect(index.getState()).toEqual({ status: 'empty' });

        const files = [{ path: 'one.md', extension: 'md', stat: { mtime: 1, size: 0 } }];
        let invalidate: (() => void) | undefined;
        const read = async () => {
            invalidate?.();
            return 'https://cdn.example.com/vault-a/image.png';
        };
        const app = {
            workspace: { getLeavesOfType: () => [], getActiveViewOfType: () => null },
            vault: {
                getMarkdownFiles: () => files,
                getAbstractFileByPath: () => files[0],
                read, cachedRead: read,
            },
        } as unknown as App;
        const refConverter = { parseReferences: () => [] } as unknown as import('../src/utils/ref-converter').RefConverter;
        const invalidatedIndex = new RemoteReferenceIndex(app, refConverter);
        invalidate = () => invalidatedIndex.invalidate();

        await expect(invalidatedIndex.scan()).rejects.toThrow('Vault changed');
        expect(invalidatedIndex.getState()).toEqual({ status: 'empty' });
    });

    it('indexes an unsaved URL from a non-active Markdown editor', async () => {
        const f = createIndex({ 'one.md': 'stale disk content' });
        f.open('one.md', 'https://cdn.example.com/vault-a/unsaved.png');
        await f.index.scan();
        expect(f.index.createLookup(mapping).classify(object('unsaved.png'))).toBe('referenced');
    });

    it.each(['edit', 'open', 'close', 'rebind'] as const)('rejects editor %s during scanning', async change => {
        const f = createIndex({ 'one.md': '', 'two.md': '' });
        const { content, view } = f.open('one.md', 'original');
        f.setOnRead(() => {
            if (change === 'edit') content.value = 'changed';
            if (change === 'open') f.open('two.md', 'new editor');
            if (change === 'close') f.views.length = 0;
            if (change === 'rebind') view.file = f.files[1]!;
        });
        await expect(f.index.scan()).rejects.toThrow();
        expect(f.index.getState().status).not.toBe('fresh');
    });

    it('rejects conflicting views and invalidates a previously fresh snapshot on failed rescan', async () => {
        const f = createIndex({ 'one.md': '' });
        await f.index.scan();
        const old = f.index.createLookup(mapping);
        f.open('one.md', 'first');
        f.open('one.md', 'second');
        await expect(f.index.scan()).rejects.toThrow();
        expect(f.index.getState().status).not.toBe('fresh');
        expect(old.classify(object('unused.png'))).toBe('unmappable');
    });

    it.each(['edit', 'open', 'close', 'rebind'] as const)('revokes new and retained lookups after editor %s', async change => {
        const f = createIndex({ 'one.md': '', 'two.md': '' });
        const { content, view } = f.open('one.md', 'original');
        await f.index.scan();
        const old = f.index.createLookup(mapping);
        expect(old.classify(object('unsaved.png'))).toBe('not-referenced-in-current-vault');
        if (change === 'edit') content.value = 'https://cdn.example.com/vault-a/unsaved.png';
        if (change === 'open') f.open('two.md', 'https://cdn.example.com/vault-a/unsaved.png');
        if (change === 'close') f.views.length = 0;
        if (change === 'rebind') view.file = f.files[1]!;
        expect(old.classify(object('unsaved.png'))).toBe('unmappable');
        expect(f.index.getState().status).toBe('stale');
        expect(f.index.createLookup(mapping).classify(object('unsaved.png'))).toBe('unmappable');
    });

    it('revokes retained lookups when invalidated or replaced by a new scan', async () => {
        const f = createIndex({ 'one.md': 'https://cdn.example.com/vault-a/used.png' });
        await f.index.scan();
        const first = f.index.createLookup(mapping);
        f.index.invalidate();
        expect(first.classify(object('unused.png'))).toBe('unmappable');
        expect(first.getReferences(object('used.png'))).toEqual([]);
        await f.index.scan();
        const second = f.index.createLookup(mapping);
        await f.index.scan();
        expect(second.classify(object('unused.png'))).toBe('unmappable');
    });

    it.each(['modify', 'delete', 'replace', 'rename'] as const)('rejects file %s during a scan before publishing fresh state', async change => {
        const f = createIndex({ 'one.md': '' });
        f.setOnRead(() => {
            const file = f.files[0]!;
            if (change === 'modify') file.stat.mtime++;
            if (change === 'delete') f.files.length = 0;
            if (change === 'replace') f.files[0] = Object.assign(new TFile(), file);
            if (change === 'rename') file.path = 'renamed.md';
        });
        await expect(f.index.scan()).rejects.toThrow('Vault changed');
        expect(f.index.getState().status).not.toBe('fresh');
    });
});
