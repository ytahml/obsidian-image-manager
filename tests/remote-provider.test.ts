import { describe, expect, it, vi } from 'vitest';

vi.mock('obsidian', () => ({ requestUrl: vi.fn() }));
import type { HostingType, ImageHostingConfig } from '../src/types';
import { createRemoteObjectProvider } from '../src/remote/provider-factory';
import { listRemoteObjects } from '../src/remote/provider';
import type { RemoteObjectProvider } from '../src/remote/provider';
import type { RemoteListRequest } from '../src/remote/types';
import { getRemoteManagementConfig, normalizeRemotePrefix } from '../src/remote/management-settings';

function createHostingConfig(type: HostingType): ImageHostingConfig {
    return {
        id: `${type}-test`,
        name: `${type} test`,
        type,
        enabled: true,
        config: {
            uploadUrl: 'https://upload.example.com',
            method: 'POST',
            headers: {},
            fileFieldName: 'file',
            jsonPath: 'url',
            extraBody: {},
        },
        uploadPath: '',
        urlPrefix: '',
    };
}

describe('remote provider factory', () => {
    it.each<HostingType>(['aliyun-oss', 'qiniu', 's3', 'custom'])(
        'returns an explicit unsupported result for %s before its adapter is implemented',
        (type) => {
            const result = createRemoteObjectProvider(createHostingConfig(type), {});

            expect(result).toMatchObject({
                status: 'unsupported',
                hostingId: `${type}-test`,
                hostingType: type,
                reason: 'not-implemented',
            });
            if (result.status === 'unsupported') {
                expect([...result.capabilities]).toEqual([]);
            }
        }
    );

    it('registers the S3 list provider in the production registry', () => {
        const config = createHostingConfig('s3');
        config.config = {
            endpoint: 'https://account.r2.cloudflarestorage.com',
            region: 'auto',
            accessKeyId: 'access-key',
            secretAccessKey: 'secret-key',
            bucket: 'images',
            forcePathStyle: true,
        };

        const result = createRemoteObjectProvider(config);

        expect(result.status).toBe('ready');
        if (result.status === 'ready') {
            expect([...result.provider.capabilities]).toEqual(['list', 'preview', 'delete']);
        }
    });

    it('creates a registered provider without changing the upload factory', () => {
        const config = createHostingConfig('s3');
        const provider: RemoteObjectProvider = {
            capabilities: new Set(['list']),
            listObjects: vi.fn(),
        };
        const builder = vi.fn(() => provider);

        const result = createRemoteObjectProvider(config, { s3: builder });

        expect(result).toEqual({ status: 'ready', provider });
        expect(builder).toHaveBeenCalledWith(config);
    });

    it('returns an unsupported result instead of throwing for an unknown persisted type', () => {
        const config = createHostingConfig('custom');
        config.type = 'removed-provider' as HostingType;

        expect(createRemoteObjectProvider(config)).toMatchObject({
            status: 'unsupported',
            reason: 'unknown-provider',
        });
    });
});

describe('remote provider pagination contract', () => {
    it('passes opaque cursors through without parsing or encoding them', async () => {
        const request: RemoteListRequest = {
            prefix: 'vault-a/',
            cursor: 'token+/=%2520&provider=value',
            limit: 100,
        };
        const nextCursor = 'next+/=%2F&still-opaque';
        const listObjects = vi.fn(async (_request: RemoteListRequest) => ({
            objects: [],
            nextCursor,
            isTruncated: true,
        }));
        const provider: RemoteObjectProvider = {
            capabilities: new Set(['list']),
            listObjects,
        };

        const page = await listRemoteObjects(provider, request);

        expect(listObjects).toHaveBeenCalledWith(request);
        expect(listObjects.mock.calls[0]?.[0]).toBe(request);
        expect(page.nextCursor).toBe(nextCursor);
    });
});

describe('remote management settings', () => {
    it('keeps legacy hosting configurations disabled by default', () => {
        const legacy = createHostingConfig('s3');

        expect(getRemoteManagementConfig(legacy)).toEqual({
            enabled: false,
            prefix: '',
            pageSize: 100,
            previewMode: 'viewport',
            previewAccess: 'presigned',
            publicUrlAliases: [],
        });
    });

    it('normalizes only leading and trailing prefix separators', () => {
        expect(normalizeRemotePrefix('///vault-a//images///')).toBe('vault-a//images');
    });
});
