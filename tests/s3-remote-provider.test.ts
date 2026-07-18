import { describe, expect, it, vi } from 'vitest';

vi.mock('obsidian', () => ({ requestUrl: vi.fn() }));
import { DOMParser as XmlDomParser } from '@xmldom/xmldom';
import type { RequestUrlParam, RequestUrlResponse } from 'obsidian';
import type { ImageHostingConfig, S3Config } from '../src/types';
import { RemoteRequestClient } from '../src/remote/request';
import {
    S3RemoteObjectProvider,
    buildListQuery,
    buildS3ReferenceMapping,
    parseS3ListObjectsV2,
    type S3XmlDocumentParser,
} from '../src/remote/providers/s3-compatible-remote';

const parseXml: S3XmlDocumentParser = (xml) =>
    new XmlDomParser().parseFromString(xml, 'application/xml') as unknown as Document;

function s3Config(overrides: Partial<S3Config> = {}): S3Config {
    return {
        endpoint: 'https://minio.example.com:9000/proxy/s3',
        region: 'us-east-1',
        accessKeyId: 'access-key',
        secretAccessKey: 'secret-key',
        bucket: 'images',
        forcePathStyle: true,
        ...overrides,
    };
}

function hostingConfig(overrides: Partial<ImageHostingConfig> = {}): ImageHostingConfig {
    return {
        id: 's3-hosting',
        name: 'S3 hosting',
        type: 's3',
        enabled: true,
        config: s3Config(),
        uploadPath: '',
        urlPrefix: 'cdn.example.com/vault',
        remoteManagement: {
            enabled: true,
            prefix: 'vault-a',
            pageSize: 2,
            previewMode: 'manual',
            previewAccess: 'presigned',
            deleteEnabled: false,
            publicUrlAliases: ['https://origin.example.com/root/'],
        },
        ...overrides,
    };
}

function response(status: number, text: string): RequestUrlResponse {
    return { status, text, headers: {}, arrayBuffer: new ArrayBuffer(0), json: {} };
}

describe('S3 ListObjectsV2 parsing', () => {
    it('parses one encoded metadata page and preserves the opaque cursor', () => {
        const page = parseS3ListObjectsV2(`
            <ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">
                <EncodingType>url</EncodingType>
                <IsTruncated>true</IsTruncated>
                <NextContinuationToken>next+/=&amp;opaque</NextContinuationToken>
                <Contents>
                    <Key>vault-a/%E4%B8%AD%E6%96%87%20image%252F.png</Key>
                    <LastModified>2026-07-18T04:05:06.000Z</LastModified>
                    <ETag>&quot;etag-value&quot;</ETag>
                    <Size>42</Size>
                    <StorageClass>STANDARD</StorageClass>
                </Contents>
                <CommonPrefixes><Prefix>vault-a/folder/</Prefix></CommonPrefixes>
            </ListBucketResult>
        `, 's3-hosting', parseXml);

        expect(page).toEqual({
            objects: [{
                hostingId: 's3-hosting',
                key: 'vault-a/中文 image%2F.png',
                size: 42,
                lastModified: Date.parse('2026-07-18T04:05:06.000Z'),
                etag: '"etag-value"',
                storageClass: 'STANDARD',
            }],
            nextCursor: 'next+/=&opaque',
            isTruncated: true,
        });
    });

    it('accepts an empty final page and rejects malformed metadata or cursors', () => {
        expect(parseS3ListObjectsV2(
            '<ListBucketResult><IsTruncated>false</IsTruncated></ListBucketResult>',
            's3-hosting',
            parseXml
        )).toEqual({ objects: [], isTruncated: false });

        expect(() => parseS3ListObjectsV2(
            '<ListBucketResult><IsTruncated>true</IsTruncated></ListBucketResult>',
            's3-hosting',
            parseXml
        )).toThrow('Remote provider response could not be parsed');
        expect(() => parseS3ListObjectsV2(`
            <ListBucketResult><IsTruncated>false</IsTruncated>
            <Contents><Key>a</Key><Size>-1</Size></Contents></ListBucketResult>
        `, 's3-hosting', parseXml)).toThrow('Remote provider response could not be parsed');
        expect(() => parseS3ListObjectsV2(
            '<not-closed>', 's3-hosting', () => { throw new Error('malformed'); }
        )).toThrow('Remote provider response could not be parsed');
        expect(() => parseS3ListObjectsV2(`
            <ListBucketResult><IsTruncated>false</IsTruncated>
            <Contents><Key>a</Key><Size>1</Size><LastModified>invalid</LastModified></Contents></ListBucketResult>
        `, 's3-hosting', parseXml)).toThrow('Remote provider response could not be parsed');
    });
});

describe('S3 remote provider', () => {
    it('requests one directory-scoped page with an encoded opaque cursor', async () => {
        const execute = vi.fn(async (_request: RequestUrlParam) => response(200, `
            <ListBucketResult><IsTruncated>false</IsTruncated></ListBucketResult>
        `));
        const provider = new S3RemoteObjectProvider(
            hostingConfig(), new RemoteRequestClient(execute), parseXml,
            () => new Date('2026-07-18T04:05:06.000Z')
        );

        await provider.listObjects({
            prefix: '/images/2026/',
            cursor: 'token+/=%2520&value',
            delimiter: '/',
            limit: 5000,
        });

        expect(execute).toHaveBeenCalledTimes(1);
        const request = execute.mock.calls[0]?.[0];
        expect(request?.url).toBe(
            'https://minio.example.com:9000/proxy/s3/images/?continuation-token=token%2B%2F%3D%252520%26value&delimiter=%2F&encoding-type=url&list-type=2&max-keys=1000&prefix=images%2F2026%2F'
        );
        expect(request?.headers?.Authorization).not.toContain('secret-key');
    });

    it.each([
        [403, 'SignatureDoesNotMatch', 'authentication'],
        [403, 'AccessDenied', 'permission'],
        [404, 'NoSuchBucket', 'not-found'],
        [503, 'SlowDown', 'rate-limit'],
    ] as const)('maps HTTP %s %s without retaining response details', async (status, serviceCode, code) => {
        const execute = vi.fn(async () => response(status,
            `<Error><Code>${serviceCode}</Code><Message>secret-key Authorization</Message></Error>`
        ));
        const provider = new S3RemoteObjectProvider(
            hostingConfig(), new RemoteRequestClient(execute), parseXml
        );

        const promise = provider.listObjects({ prefix: '', limit: 1 });

        await expect(promise).rejects.toMatchObject({ code, status });
        await promise.catch((error: unknown) => {
            expect(JSON.stringify(error)).not.toContain('secret-key');
            expect(JSON.stringify(error)).not.toContain('Authorization');
        });
    });

    it('maps invalid generic S3 configuration without exposing its value', async () => {
        const provider = new S3RemoteObjectProvider(hostingConfig({
            config: s3Config({ endpoint: 'user:password@host?token=secret', region: '' }),
        }), new RemoteRequestClient(vi.fn()), parseXml);

        await expect(provider.listObjects({ prefix: '', limit: 1 }))
            .rejects.toMatchObject({ code: 'configuration' });
    });

    it('creates a 300-second private preview without making a provider request', async () => {
        const execute = vi.fn();
        const provider = new S3RemoteObjectProvider(
            hostingConfig(), new RemoteRequestClient(execute), parseXml,
            () => new Date('2026-07-18T04:05:06.000Z')
        );

        const preview = await provider.createPreviewUrl({
            hostingId: 's3-hosting',
            key: 'vault-a/中文 image.png',
            size: 42,
        });

        expect(preview).toMatchObject({
            access: 'presigned',
            expiresAt: Date.parse('2026-07-18T04:10:06.000Z'),
        });
        expect(preview.url).toContain('/proxy/s3/images/vault-a/%E4%B8%AD%E6%96%87%20image.png?');
        expect(preview.url).toContain('X-Amz-Expires=300');
        expect(execute).not.toHaveBeenCalled();
    });

    it('uses only urlPrefix for an explicitly public preview', async () => {
        const config = hostingConfig();
        config.remoteManagement!.previewAccess = 'public';
        const provider = new S3RemoteObjectProvider(config);

        await expect(provider.createPreviewUrl({
            hostingId: config.id,
            key: 'images/中文 #?%()+&=.png',
            size: 1,
        })).resolves.toEqual({
            access: 'public',
            url: 'https://cdn.example.com/vault/images/%E4%B8%AD%E6%96%87%20%23%3F%25%28%29%2B%26%3D.png',
        });
    });

    it('rejects a public preview without retaining or guessing an endpoint URL', async () => {
        const config = hostingConfig({ urlPrefix: '' });
        config.remoteManagement!.previewAccess = 'public';
        const provider = new S3RemoteObjectProvider(config);

        const promise = provider.createPreviewUrl({
            hostingId: config.id,
            key: 'images/a.png',
            size: 1,
        });
        await expect(promise).rejects.toMatchObject({ code: 'configuration' });
        await promise.catch((error: unknown) => {
            expect(JSON.stringify(error)).not.toContain('minio.example.com');
        });
    });
});

describe('S3 remote mapping', () => {
    it('combines normalized public, CDN, path-style, and virtual-hosted bases', () => {
        const mapping = buildS3ReferenceMapping(hostingConfig());

        expect(mapping).toEqual({
            hostingId: 's3-hosting',
            urlPrefix: 'https://cdn.example.com/vault',
            publicUrlAliases: [
                'https://origin.example.com/root',
                'https://minio.example.com:9000/proxy/s3/images',
                'https://images.minio.example.com:9000/proxy/s3',
            ],
        });
    });
});

describe('S3 list query', () => {
    it('keeps the bucket root empty and clamps the requested page size', () => {
        expect(buildListQuery({ prefix: '', limit: 0 })).toEqual([
            ['list-type', '2'],
            ['encoding-type', 'url'],
            ['max-keys', '1'],
        ]);
        expect(buildListQuery({ prefix: '', limit: Number.NaN })).toContainEqual([
            'max-keys', '100',
        ]);
    });

    it('keeps a nested directory prefix and appends exactly one scope separator', () => {
        expect(buildListQuery({ prefix: '/images/2026/', limit: 10 })).toContainEqual([
            'prefix', 'images/2026/',
        ]);
    });
});
