import { describe, expect, it, vi } from 'vitest';
import type { ImageHostingConfig } from '../src/types';
import { RemoteBrowseSession } from '../src/remote/browse-session';
import type { RemoteObjectProvider } from '../src/remote/provider';
import type { RemoteListPage, RemoteListRequest } from '../src/remote/types';
import { RemoteProviderError } from '../src/remote/errors';
import { getRemoteResults } from '../src/remote/result-page';

function config(prefix = 'vault-a'): ImageHostingConfig {
    return {
        id: 's3-test',
        name: 'S3 test',
        type: 's3',
        enabled: true,
        config: { endpoint: '', region: '', accessKeyId: '', secretAccessKey: '', bucket: 'bucket' },
        uploadPath: '',
        urlPrefix: 'https://img.example.com',
        remoteManagement: {
            enabled: true,
            prefix,
            pageSize: 100,
            previewMode: 'manual',
            previewAccess: 'presigned',
            publicUrlAliases: [],
        },
    };
}

describe('remote browse session', () => {
    it('filters and sorts the complete scanned set without pagination', () => {
        const results = getRemoteResults([
            { hostingId: 's3-test', key: 'images/b.png', size: 20 },
            { hostingId: 's3-test', key: 'archive/a.png', size: 10 },
            { hostingId: 's3-test', key: 'images/a.png', size: 30 },
        ], 'images/', 'size');

        expect(results.map((item) => item.key)).toEqual(['images/b.png', 'images/a.png']);
    });

    it('sorts every field in both directions with deterministic ties', () => {
        const objects = [
            { hostingId: 's3-test', key: 'c.png', size: 10, lastModified: 20 },
            { hostingId: 's3-test', key: 'a.png', size: 10, lastModified: 10 },
            { hostingId: 's3-test', key: 'b.png', size: 20, lastModified: 20 },
            { hostingId: 's3-test', key: 'missing.png', size: 30 },
        ];

        expect(getRemoteResults(objects, '', 'key', 'asc').map((item) => item.key))
            .toEqual(['a.png', 'b.png', 'c.png', 'missing.png']);
        expect(getRemoteResults(objects, '', 'key', 'desc').map((item) => item.key))
            .toEqual(['missing.png', 'c.png', 'b.png', 'a.png']);
        expect(getRemoteResults(objects, '', 'size', 'asc').map((item) => item.key))
            .toEqual(['a.png', 'c.png', 'b.png', 'missing.png']);
        expect(getRemoteResults(objects, '', 'size', 'desc').map((item) => item.key))
            .toEqual(['missing.png', 'b.png', 'a.png', 'c.png']);
        expect(getRemoteResults(objects, '', 'modified', 'asc').map((item) => item.key))
            .toEqual(['a.png', 'b.png', 'c.png', 'missing.png']);
        expect(getRemoteResults(objects, '', 'modified', 'desc').map((item) => item.key))
            .toEqual(['b.png', 'c.png', 'a.png', 'missing.png']);
    });

    it('accepts a complete first page without a continuation cursor', async () => {
        const provider: RemoteObjectProvider = {
            capabilities: new Set(['list']),
            listObjects: vi.fn(async () => ({
                objects: [{ hostingId: 's3-test', key: 'only-page.png', size: 1 }],
                isTruncated: false,
            })),
        };
        const session = new RemoteBrowseSession();

        await expect(session.scan(provider, config())).resolves.toBe(true);
        expect(session.getSnapshot().status).toBe('ready');
        expect(session.getAllObjects().map((object) => object.key)).toEqual(['only-page.png']);
    });

    it('does not request until an explicit scan and preserves opaque cursors', async () => {
        const listObjects = vi.fn(async () => ({
            objects: [{ hostingId: 's3-test', key: 'a.png', size: 1 }],
            nextCursor: 'opaque+/=%2520',
            isTruncated: true,
        }));
        const provider: RemoteObjectProvider = { capabilities: new Set(['list']), listObjects };
        const session = new RemoteBrowseSession();

        expect(listObjects).not.toHaveBeenCalled();
        await session.scan(provider, config());

        expect(listObjects).toHaveBeenCalledWith({ prefix: 'vault-a', cursor: undefined, limit: 1000 });
        expect(session.getSnapshot().status).toBe('ready');
        expect(session.getSnapshot().pages[0]?.result.nextCursor).toBe('opaque+/=%2520');
    });

    it('aggregates remote pages into one searchable result set', async () => {
        const listObjects = vi.fn()
            .mockResolvedValueOnce({ objects: [{ hostingId: 's3-test', key: 'a', size: 1 }], nextCursor: 'next-token', isTruncated: true })
            .mockResolvedValueOnce({ objects: [{ hostingId: 's3-test', key: 'b', size: 1 }], isTruncated: false });
        const provider: RemoteObjectProvider = { capabilities: new Set(['list']), listObjects };
        const session = new RemoteBrowseSession();
        const hosting = config();

        await session.scan(provider, hosting);
        await session.loadNextBatch(provider, hosting, 10);
        expect(listObjects).toHaveBeenCalledTimes(2);
        expect(session.getAllObjects().map((object) => object.key)).toEqual(['a', 'b']);
        expect(session.hasMore()).toBe(false);
    });

    it('pauses automatic scanning after the requested number of list calls', async () => {
        let request = 0;
        const listObjects = vi.fn(async () => ({
            objects: [{ hostingId: 's3-test', key: String(request++), size: 1 }],
            nextCursor: `cursor-${request}`,
            isTruncated: true,
        }));
        const provider: RemoteObjectProvider = { capabilities: new Set(['list']), listObjects };
        const session = new RemoteBrowseSession();

        await session.scan(provider, config());
        await session.loadNextBatch(provider, config(), 9);

        expect(listObjects).toHaveBeenCalledTimes(10);
        expect(session.getAllObjects()).toHaveLength(10);
        expect(session.hasMore()).toBe(true);
    });

    it('drops late results after stop or scope invalidation', async () => {
        let resolveList: ((page: RemoteListPage) => void) | undefined;
        const provider: RemoteObjectProvider = {
            capabilities: new Set(['list']),
            listObjects: vi.fn((_request: RemoteListRequest) => new Promise<RemoteListPage>((resolve) => { resolveList = resolve; })),
        };
        const session = new RemoteBrowseSession();
        const pending = session.scan(provider, config());
        session.stop();
        resolveList?.({ objects: [], isTruncated: false });

        await expect(pending).resolves.toBe(false);
        expect(session.getSnapshot().status).toBe('stopped');
        expect(session.getSnapshot().pages).toEqual([]);
    });

    it('rejects a truncated result without a usable next cursor', async () => {
        const provider: RemoteObjectProvider = {
            capabilities: new Set(['list']),
            listObjects: vi.fn(async () => ({ objects: [], isTruncated: true })),
        };
        const session = new RemoteBrowseSession();

        await expect(session.scan(provider, config())).resolves.toBe(false);
        expect(session.getSnapshot()).toMatchObject({ status: 'error', error: { code: 'invalid-cursor' } });
    });

    it('publishes only structured provider errors to the browser', async () => {
        const provider: RemoteObjectProvider = {
            capabilities: new Set(['list']),
            listObjects: vi.fn(async () => {
                throw new RemoteProviderError('permission', { status: 403 });
            }),
        };
        const session = new RemoteBrowseSession();

        await expect(session.scan(provider, config())).resolves.toBe(false);
        expect(session.getSnapshot()).toMatchObject({
            status: 'error',
            error: { code: 'permission', status: 403 },
        });
    });
});
