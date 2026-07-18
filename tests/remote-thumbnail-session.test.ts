import { describe, expect, it, vi } from 'vitest';
import type { RemoteObjectProvider } from '../src/remote/provider';
import { RemotePreviewSession } from '../src/remote/preview-session';
import { RemoteThumbnailSession } from '../src/remote/thumbnail-session';
import type { RemoteObject, RemotePreviewUrl } from '../src/remote/types';

function object(index: number): RemoteObject {
    return { hostingId: 's3-test', key: `images/${index}.png`, size: index };
}

describe('remote thumbnail session', () => {
    it('limits URL resolution to four concurrent visible thumbnails', async () => {
        const resolvers: Array<(value: RemotePreviewUrl) => void> = [];
        const createPreviewUrl = vi.fn(() => new Promise<RemotePreviewUrl>((resolve) => {
            resolvers.push(resolve);
        }));
        const provider: RemoteObjectProvider = {
            capabilities: new Set(['preview']),
            listObjects: vi.fn(),
            createPreviewUrl,
        };
        const session = new RemoteThumbnailSession(new RemotePreviewSession(), 4);
        const ready = vi.fn();

        for (let index = 0; index < 6; index++) {
            session.enqueue(provider, object(index), { onReady: ready, onError: vi.fn() });
        }
        expect(createPreviewUrl).toHaveBeenCalledTimes(4);

        resolvers[0]?.({ url: 'first', access: 'public' });
        await vi.waitFor(() => expect(createPreviewUrl).toHaveBeenCalledTimes(5));
        expect(ready).toHaveBeenCalledTimes(1);
    });

    it('drops queued work and ignores late URL results when the view changes', async () => {
        let resolve: ((value: RemotePreviewUrl) => void) | undefined;
        const provider: RemoteObjectProvider = {
            capabilities: new Set(['preview']),
            listObjects: vi.fn(),
            createPreviewUrl: vi.fn(() => new Promise<RemotePreviewUrl>((done) => {
                resolve = done;
            })),
        };
        const session = new RemoteThumbnailSession(new RemotePreviewSession(), 1);
        const ready = vi.fn();
        session.enqueue(provider, object(1), { onReady: ready, onError: vi.fn() });
        session.enqueue(provider, object(2), { onReady: ready, onError: vi.fn() });

        session.resetView();
        resolve?.({ url: 'late', access: 'public' });
        await Promise.resolve();
        await Promise.resolve();

        expect(ready).not.toHaveBeenCalled();
        expect(provider.createPreviewUrl).toHaveBeenCalledTimes(1);
    });
});
