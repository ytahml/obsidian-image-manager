import { describe, expect, it, vi } from 'vitest';

vi.mock('obsidian', () => ({
    App: class {},
    TFile: class {},
}));

import type { App } from 'obsidian';
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
            reference('HTTPS://CDN.EXAMPLE.COM:443/vault-a/nested/%E4%B8%AD%E6%96%87%20image.png#preview', 'referenced'),
            reference('https://origin.example.com/bucket/vault-a/nested/other.png', 'possibly-referenced'),
        ], { isComplete: true });

        expect(lookup.classify(object('nested/中文 image.png'))).toBe('referenced');
        expect(lookup.classify(object('nested/other.png'))).toBe('possibly-referenced');
        expect(lookup.classify(object('other.png'))).toBe('not-referenced-in-current-vault');
        expect(lookup.classify(object('nested/other.png', 'other-hosting'))).toBe('unmappable');
    });

    it('keeps encoded slashes and double-encoded percent values distinct', () => {
        const lookup = createRemoteObjectReferenceLookup(mapping, [
            reference('https://cdn.example.com/vault-a/a%2Fb.png', 'referenced'),
            reference('https://cdn.example.com/vault-a/file%2520name.png', 'referenced'),
        ], { isComplete: true });

        expect(lookup.classify(object('a%2Fb.png'))).toBe('referenced');
        expect(lookup.classify(object('a/b.png'))).toBe('not-referenced-in-current-vault');
        expect(lookup.classify(object('file%20name.png'))).toBe('referenced');
        expect(lookup.classify(object('file name.png'))).toBe('not-referenced-in-current-vault');
    });

    it('treats unapproved query parameters and malformed managed paths as unmappable', () => {
        const lookup = createRemoteObjectReferenceLookup(mapping, [
            reference('https://cdn.example.com/vault-a/private.png?token=secret', 'possibly-referenced'),
            reference('https://cdn.example.com/vault-a/broken%ZZ.png', 'possibly-referenced'),
        ], { isComplete: true });

        expect(lookup.classify(object('private.png'))).toBe('unmappable');
        expect(lookup.classify(object('another.png'))).toBe('unmappable');
    });

    it('accepts explicitly ignored query names and rejects path-prefix lookalikes', () => {
        const lookup = createRemoteObjectReferenceLookup(mapping, [
            reference('https://cdn.example.com/vault-a/image%23%3F%25%28x%29.png?token=secret', 'referenced'),
            reference('https://cdn.example.com/vault-a-extra/not-a-match.png', 'referenced'),
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
            'possibly-referenced'
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
): { index: RemoteReferenceIndex; setContent: (path: string, content: string) => void } {
    const files = Object.keys(contents).map((path) => ({ path, extension: 'md' }));
    const app = {
        vault: {
            getMarkdownFiles: () => files,
            cachedRead: async (file: TestFile) => contents[file.path] ?? '',
        },
    } as unknown as App;
    const refConverter = {
        parseReferences(text: string) {
            const match = /!\[[^\]]*\]\(([^)]+)\)/g;
            const references: Array<{ format: 'markdown'; path: string; col: number; fullMatch: string }> = [];
            let result: RegExpExecArray | null;
            while ((result = match.exec(text)) !== null) {
                references.push({
                    format: 'markdown',
                    path: result[1] ?? '',
                    col: result.index,
                    fullMatch: result[0],
                });
            }
            return references;
        },
    } as unknown as import('../src/utils/ref-converter').RefConverter;

    return {
        index: new RemoteReferenceIndex(app, refConverter, now),
        setContent(path, content) {
            contents[path] = content;
        },
    };
}

describe('remote reference index', () => {
    it('scans Markdown-only references and never retains signed query values', async () => {
        const { index } = createIndex({
            'one.md': [
                '![image](https://cdn.example.com/vault-a/definite.png)',
                '<img src="https://cdn.example.com/vault-a/html.png?token=secret">',
                '[plain](https://cdn.example.com/vault-a/link.png)',
                'https://cdn.example.com/vault-a/raw.png',
                '![[local.png]]',
            ].join('\n'),
            'two.md': 'https://outside.example.com/image.png',
        });

        await expect(index.scan()).resolves.toEqual({
            scannedAt: 12345,
            markdownFileCount: 2,
            referencedCount: 1,
            possiblyReferencedCount: 4,
            unmappableCount: 0,
            canvasIncluded: false,
        });

        const lookup = index.createLookup(mapping);
        expect(lookup.classify(object('definite.png'))).toBe('referenced');
        expect(lookup.classify(object('html.png'))).toBe('possibly-referenced');
        expect(lookup.classify(object('link.png'))).toBe('possibly-referenced');
        expect(lookup.classify(object('raw.png'))).toBe('possibly-referenced');
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

        const files = [{ path: 'one.md', extension: 'md' }];
        let invalidate: (() => void) | undefined;
        const app = {
            vault: {
                getMarkdownFiles: () => files,
                cachedRead: async () => {
                    invalidate?.();
                    return 'https://cdn.example.com/vault-a/image.png';
                },
            },
        } as unknown as App;
        const refConverter = { parseReferences: () => [] } as unknown as import('../src/utils/ref-converter').RefConverter;
        const invalidatedIndex = new RemoteReferenceIndex(app, refConverter);
        invalidate = () => invalidatedIndex.invalidate();

        await expect(invalidatedIndex.scan()).rejects.toThrow('Vault changed');
        expect(invalidatedIndex.getState()).toEqual({ status: 'empty' });
    });
});
