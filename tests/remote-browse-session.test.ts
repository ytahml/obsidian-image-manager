import { describe, expect, it, vi } from 'vitest';
import type { ImageHostingConfig } from '../src/types';
import { RemoteBrowseSession } from '../src/remote/browse-session';
import type { RemoteObjectProvider } from '../src/remote/provider';
import type { RemoteListPage, RemoteListRequest } from '../src/remote/types';
import { RemoteProviderError } from '../src/remote/errors';

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
            deleteEnabled: false,
            publicUrlAliases: [],
        },
    };
}

describe('remote browse session', () => {
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

        expect(listObjects).toHaveBeenCalledWith({ prefix: 'vault-a', cursor: undefined, limit: 100 });
        expect(session.getSnapshot().status).toBe('ready');
        expect(session.getSnapshot().pages[0]?.result.nextCursor).toBe('opaque+/=%2520');
    });

    it('caches previous pages and only fetches an uncached next page', async () => {
        const listObjects = vi.fn()
            .mockResolvedValueOnce({ objects: [{ hostingId: 's3-test', key: 'a', size: 1 }], nextCursor: 'next-token', isTruncated: true })
            .mockResolvedValueOnce({ objects: [{ hostingId: 's3-test', key: 'b', size: 1 }], isTruncated: false });
        const provider: RemoteObjectProvider = { capabilities: new Set(['list']), listObjects };
        const session = new RemoteBrowseSession();
        const hosting = config();

        await session.scan(provider, hosting);
        await session.next(provider, hosting);
        expect(listObjects).toHaveBeenCalledTimes(2);
        expect(session.previous()).toBe(true);
        expect(session.getCurrentObjects()[0]?.key).toBe('a');
        await session.next(provider, hosting);
        expect(listObjects).toHaveBeenCalledTimes(2);
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
