import { describe, expect, it, vi } from 'vitest';

vi.mock('obsidian', () => ({ requestUrl: vi.fn() }));

import { DOMParser as XmlDomParser } from '@xmldom/xmldom';
import type { RequestUrlParam, RequestUrlResponse } from 'obsidian';
import type { AliyunOSSConfig, ImageHostingConfig } from '../src/types';
import { RemoteRequestClient } from '../src/remote/request';
import {
    AliyunOSSRemoteObjectProvider,
    buildOssListQuery,
    buildOssReferenceMapping,
} from '../src/remote/providers/aliyun-oss-remote';
import { buildOssCanonicalQuery, presignOssGetRequest, signOssRequest } from '../src/oss/sigv4';

const parseXml = (xml: string): Document =>
    new XmlDomParser().parseFromString(xml, 'application/xml') as unknown as Document;

function ossConfig(overrides: Partial<AliyunOSSConfig> = {}): AliyunOSSConfig {
    return {
        region: 'cn-hangzhou',
        accessKeyId: 'access-key',
        accessKeySecret: 'secret-key',
        bucket: 'images',
        ...overrides,
    };
}

function hostingConfig(overrides: Partial<ImageHostingConfig> = {}): ImageHostingConfig {
    return {
        id: 'oss-hosting',
        name: 'OSS hosting',
        type: 'aliyun-oss',
        enabled: true,
        config: ossConfig(),
        uploadPath: '',
        urlPrefix: 'cdn.example.com/vault',
        remoteManagement: {
            enabled: true,
            prefix: 'vault-a',
            pageSize: 100,
            previewMode: 'viewport',
            previewAccess: 'presigned',
            publicUrlAliases: ['https://old.example.com/images/'],
        },
        ...overrides,
    };
}

function response(status: number, text: string, headers: Record<string, string> = {}): RequestUrlResponse {
    return { status, text, headers, arrayBuffer: new ArrayBuffer(0), json: {} };
}

describe('OSS V4 requests', () => {
    it('sorts and encodes query parameters without re-encoding opaque values', () => {
        expect(buildOssCanonicalQuery([
            ['prefix', '中文 space/'],
            ['continuation-token', 'next+/=%2520&opaque'],
            ['list-type', '2'],
        ])).toBe(
            'continuation-token=next%2B%2F%3D%252520%26opaque&list-type=2&prefix=%E4%B8%AD%E6%96%87%20space%2F'
        );
    });

    it('uses one encoded canonical URI for list and private preview requests', async () => {
        const now = new Date('2026-07-25T04:05:06.000Z');
        const request = await signOssRequest({
            config: ossConfig(), method: 'GET', key: 'folder/中文 #?.png',
            query: [['list-type', '2']], now,
        });
        expect(request.url).toBe(
            'https://images.oss-cn-hangzhou.aliyuncs.com/folder/%E4%B8%AD%E6%96%87%20%23%3F.png?list-type=2'
        );
        expect(request.headers.Authorization).toMatch(/^OSS4-HMAC-SHA256 Credential=access-key\/20260725\/cn-hangzhou\/oss\/aliyun_v4_request,/);
        expect(request.headers.Authorization).not.toContain('secret-key');

        const preview = await presignOssGetRequest({
            config: ossConfig(), key: 'folder/中文 #?.png', expiresInSeconds: 300, now,
        });
        expect(preview.url).toContain('/folder/%E4%B8%AD%E6%96%87%20%23%3F.png?');
        expect(preview.url).toContain('x-oss-expires=300');
        expect(preview.url).toContain('x-oss-signature=');
        expect(preview.expiresAt).toBe(Date.parse('2026-07-25T04:10:06.000Z'));
    });
});

describe('Aliyun OSS remote provider', () => {
    it('requests a directory-scoped page and exposes the standard metadata result', async () => {
        const execute = vi.fn(async (_request: RequestUrlParam) => response(200, `
            <ListBucketResult><EncodingType>url</EncodingType><IsTruncated>true</IsTruncated>
            <NextContinuationToken>next+/=&amp;opaque</NextContinuationToken>
            <Contents><Key>images/%E4%B8%AD%E6%96%87%20%252F.png</Key><Size>42</Size>
            <LastModified>2026-07-25T04:05:06.000Z</LastModified><ETag>&quot;etag&quot;</ETag>
            <StorageClass>STANDARD</StorageClass></Contents></ListBucketResult>
        `));
        const provider = new AliyunOSSRemoteObjectProvider(
            hostingConfig(), new RemoteRequestClient(execute), parseXml, () => new Date('2026-07-25T04:05:06.000Z')
        );
        await expect(provider.listObjects({ prefix: '/images/', cursor: 'opaque+/=%2520&value', limit: 5000 }))
            .resolves.toMatchObject({
                nextCursor: 'next+/=&opaque', isTruncated: true,
                objects: [{ hostingId: 'oss-hosting', key: 'images/中文 %2F.png', size: 42, storageClass: 'STANDARD' }],
            });
        expect(execute.mock.calls[0]?.[0].url).toBe(
            'https://images.oss-cn-hangzhou.aliyuncs.com/?continuation-token=opaque%2B%2F%3D%252520%26value&encoding-type=url&list-type=2&max-keys=1000&prefix=images%2F'
        );
    });

    it('lists direct child folders and rejects folders outside the requested scope', async () => {
        const execute = vi.fn(async (_request: RequestUrlParam) => response(200, `
            <ListBucketResult><EncodingType>url</EncodingType><IsTruncated>false</IsTruncated>
            <CommonPrefixes><Prefix>images/2026/</Prefix></CommonPrefixes></ListBucketResult>
        `));
        const provider = new AliyunOSSRemoteObjectProvider(hostingConfig(), new RemoteRequestClient(execute), parseXml);
        await expect(provider.listFolders?.({ prefix: 'images', limit: 100 })).resolves.toEqual({
            prefixes: ['images/2026'], isTruncated: false,
        });
        expect(buildOssListQuery({ prefix: 'images', delimiter: '/', limit: 100 })).toEqual([
            ['list-type', '2'], ['encoding-type', 'url'], ['max-keys', '100'], ['prefix', 'images/'], ['delimiter', '/'],
        ]);
    });

    it.each([
        [403, 'SignatureDoesNotMatch', 'authentication'],
        [403, 'AccessDenied', 'permission'],
        [404, 'NoSuchBucket', 'not-found'],
        [503, 'SlowDown', 'rate-limit'],
    ] as const)('maps OSS HTTP %s %s without leaking response details', async (status, serviceCode, code) => {
        const execute = vi.fn(async () => response(status,
            `<Error><Code>${serviceCode}</Code><Message>secret-key Authorization</Message></Error>`
        ));
        const provider = new AliyunOSSRemoteObjectProvider(hostingConfig(), new RemoteRequestClient(execute), parseXml);
        const promise = provider.listObjects({ prefix: '', limit: 1 });
        await expect(promise).rejects.toMatchObject({ code, status });
        await promise.catch((error: unknown) => {
            expect(JSON.stringify(error)).not.toContain('secret-key');
            expect(JSON.stringify(error)).not.toContain('Authorization');
        });
    });

    it('builds public and private previews and preserves guarded delete semantics', async () => {
        const config = hostingConfig();
        const execute = vi.fn()
            .mockResolvedValueOnce(response(204, '', { 'x-oss-delete-marker': 'true' }))
            .mockResolvedValueOnce(response(403, '<Error><Code>AccessDenied</Code></Error>'));
        const provider = new AliyunOSSRemoteObjectProvider(
            config, new RemoteRequestClient(execute), parseXml, () => new Date('2026-07-25T04:05:06.000Z')
        );
        const object = { hostingId: config.id, key: 'vault-a/中文 #?.png', size: 1 };
        await expect(provider.createPreviewUrl(object)).resolves.toMatchObject({
            access: 'presigned', expiresAt: Date.parse('2026-07-25T04:10:06.000Z'),
        });
        config.remoteManagement!.previewAccess = 'public';
        await expect(provider.createPreviewUrl(object)).resolves.toEqual({
            access: 'public', url: 'https://cdn.example.com/vault/vault-a/%E4%B8%AD%E6%96%87%20%23%3F.png',
        });
        await expect(provider.deleteObject(object)).resolves.toMatchObject({ success: true, status: 204, deletionKind: 'delete-marker' });
        await expect(provider.deleteObject(object)).resolves.toMatchObject({ success: false, status: 403, failureCode: 'permission' });
        const deleteRequest = execute.mock.calls[0]?.[0] as RequestUrlParam | undefined;
        expect(deleteRequest?.url).toContain('/vault-a/%E4%B8%AD%E6%96%87%20%23%3F.png');
    });

    it('maps source origin, public base, and aliases for conservative reference matching', () => {
        expect(buildOssReferenceMapping(hostingConfig())).toEqual({
            hostingId: 'oss-hosting',
            urlPrefix: 'https://cdn.example.com/vault',
            publicUrlAliases: [
                'https://old.example.com/images',
                'https://images.oss-cn-hangzhou.aliyuncs.com',
            ],
        });
    });
});
