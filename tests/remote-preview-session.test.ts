import { describe, expect, it, vi } from 'vitest';
import type { RemoteObjectProvider } from '../src/remote/provider';
import { RemotePreviewSession } from '../src/remote/preview-session';
import type { RemoteObject } from '../src/remote/types';
import type { ImageHostingConfig } from '../src/types';
import { getRemotePreviewUnavailableReason } from '../src/remote/preview-policy';

const object: RemoteObject = {
    hostingId: 's3-test',
    key: 'images/a.png',
    size: 1,
};

describe('remote preview session', () => {
    it('reuses a valid URL and renews one inside the expiry safety window', async () => {
        const createPreviewUrl = vi.fn()
            .mockResolvedValueOnce({ url: 'signed-one', access: 'presigned', expiresAt: 100_000 })
            .mockResolvedValueOnce({ url: 'signed-two', access: 'presigned', expiresAt: 200_000 });
        const provider: RemoteObjectProvider = {
            capabilities: new Set(['list', 'preview']),
            listObjects: vi.fn(),
            createPreviewUrl,
        };
        const session = new RemotePreviewSession();

        await expect(session.resolveUrl(provider, object, { now: 1_000 }))
            .resolves.toMatchObject({ url: 'signed-one' });
        await expect(session.resolveUrl(provider, object, { now: 60_000 }))
            .resolves.toMatchObject({ url: 'signed-one' });
        await expect(session.resolveUrl(provider, object, { now: 70_000 }))
            .resolves.toMatchObject({ url: 'signed-two' });
        expect(createPreviewUrl).toHaveBeenCalledTimes(2);
    });

    it('forces retry regeneration and isolates a late result after invalidation', async () => {
        let finish: ((value: { url: string; access: 'presigned' }) => void) | undefined;
        const createPreviewUrl = vi.fn(() => new Promise<{ url: string; access: 'presigned' }>((resolve) => {
            finish = resolve;
        }));
        const provider: RemoteObjectProvider = {
            capabilities: new Set(['preview']),
            listObjects: vi.fn(),
            createPreviewUrl,
        };
        const session = new RemotePreviewSession();
        const pending = session.resolveUrl(provider, object, { force: true });

        session.invalidate();
        finish?.({ url: 'late-signed-url', access: 'presigned' });

        await expect(pending).resolves.toBeUndefined();
        expect(JSON.stringify(session)).not.toContain('late-signed-url');
    });

    it('shares one in-flight URL request between a thumbnail and full preview', async () => {
        let finish: ((value: { url: string; access: 'public' }) => void) | undefined;
        const createPreviewUrl = vi.fn(() => new Promise<{ url: string; access: 'public' }>((resolve) => {
            finish = resolve;
        }));
        const provider: RemoteObjectProvider = {
            capabilities: new Set(['preview']),
            listObjects: vi.fn(),
            createPreviewUrl,
        };
        const session = new RemotePreviewSession();

        const thumbnail = session.resolveUrl(provider, object);
        const fullPreview = session.resolveUrl(provider, object);
        expect(createPreviewUrl).toHaveBeenCalledTimes(1);
        finish?.({ url: 'shared-url', access: 'public' });

        await expect(thumbnail).resolves.toMatchObject({ url: 'shared-url' });
        await expect(fullPreview).resolves.toMatchObject({ url: 'shared-url' });
    });

    it('counts only actual image request attempts', () => {
        const session = new RemotePreviewSession();

        expect(session.getRequestCount()).toBe(0);
        expect(session.recordImageRequest()).toBe(1);
        expect(session.recordImageRequest()).toBe(2);
    });
});

describe('remote preview policy', () => {
    const config: ImageHostingConfig = {
        id: 's3-test',
        name: 'S3 test',
        type: 's3',
        enabled: true,
        config: {
            endpoint: 'https://s3.example.com',
            region: 'us-east-1',
            accessKeyId: 'access-key',
            secretAccessKey: 'secret-key',
            bucket: 'images',
        },
        uploadPath: '',
        urlPrefix: '',
        remoteManagement: {
            enabled: true,
            prefix: '',
            pageSize: 100,
            previewMode: 'manual',
            previewAccess: 'public',
            publicUrlAliases: [],
        },
    };
    const createPreviewUrl = vi.fn();
    const provider: RemoteObjectProvider = {
        capabilities: new Set(['preview']),
        listObjects: vi.fn(),
        createPreviewUrl,
    };

    it('blocks missing public bases, unsupported types, and archive storage without requesting', () => {
        expect(getRemotePreviewUnavailableReason(config, provider, object, ['png']))
            .toBe('public-url-required');

        const publicConfig = { ...config, urlPrefix: 'https://cdn.example.com' };
        expect(getRemotePreviewUnavailableReason(
            publicConfig, provider, { ...object, key: 'images/readme.txt' }, ['png']
        )).toBe('not-image');
        expect(getRemotePreviewUnavailableReason(
            publicConfig, provider, { ...object, storageClass: 'DEEP_ARCHIVE' }, ['png']
        )).toBe('archived');
        expect(getRemotePreviewUnavailableReason(
            publicConfig, provider, { ...object, storageClass: 'ColdArchive' }, ['png']
        )).toBe('archived');
        expect(getRemotePreviewUnavailableReason(
            publicConfig, provider, { ...object, storageClass: 'DeepColdArchive' }, ['png']
        )).toBe('archived');
        expect(createPreviewUrl).not.toHaveBeenCalled();
    });

    it('allows supported image extensions case-insensitively', () => {
        const publicConfig = { ...config, urlPrefix: 'https://cdn.example.com' };

        expect(getRemotePreviewUnavailableReason(
            publicConfig, provider, { ...object, key: 'images/photo.PNG' }, ['png']
        )).toBeUndefined();
    });
});
