import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RequestUrlParam } from 'obsidian';
import type { ImageHostingConfig, S3Config } from '../src/types';

const { requestUrl } = vi.hoisted(() => ({ requestUrl: vi.fn() }));

vi.mock('obsidian', () => ({ requestUrl }));

import { S3Uploader } from '../src/uploaders/s3-compatible';
import { buildS3CanonicalUri, buildS3Url } from '../src/uploaders/s3-path';
import { createUploader } from '../src/uploaders/uploader-factory';
import { buildS3CanonicalQuery, signS3Request } from '../src/s3/sigv4';

function createS3Config(overrides: Partial<S3Config> = {}): S3Config {
    return {
        endpoint: 'minio.example.com:9000',
        region: 'us-east-1',
        accessKeyId: 'access-key',
        secretAccessKey: 'secret-key',
        bucket: 'images',
        forcePathStyle: true,
        ...overrides,
    };
}

function createHostingConfig(s3Config: S3Config, urlPrefix = ''): ImageHostingConfig {
    return {
        id: 's3-test',
        name: 'S3 test',
        type: 's3',
        enabled: true,
        config: s3Config,
        uploadPath: 'uploads/{filename}.{ext}',
        urlPrefix,
    };
}

describe('S3 path construction', () => {
    it('adds HTTPS and builds a path-style URL with encoded key segments', () => {
        const config = createS3Config();

        expect(buildS3Url(config, 'folder/中文 图.png')).toBe(
            'https://minio.example.com:9000/images/folder/%E4%B8%AD%E6%96%87%20%E5%9B%BE.png'
        );
        expect(buildS3CanonicalUri(config, 'folder/中文 图.png')).toBe(
            '/images/folder/%E4%B8%AD%E6%96%87%20%E5%9B%BE.png'
        );
    });

    it('preserves HTTP and builds a virtual-hosted-style URL', () => {
        const config = createS3Config({
            endpoint: 'http://s3.example.com:9000',
            forcePathStyle: false,
        });

        expect(buildS3Url(config, 'folder/a b.png')).toBe(
            'http://images.s3.example.com:9000/folder/a%20b.png'
        );
        expect(buildS3CanonicalUri(config, 'folder/a b.png')).toBe('/folder/a%20b.png');
    });

    it('encodes characters excluded by the AWS SigV4 unreserved set', () => {
        const config = createS3Config();

        expect(buildS3Url(config, "folder/!file'()*.png")).toBe(
            'https://minio.example.com:9000/images/folder/%21file%27%28%29%2A.png'
        );
        expect(buildS3CanonicalUri(config, "folder/!file'()*.png")).toBe(
            '/images/folder/%21file%27%28%29%2A.png'
        );
    });

    it('keeps an endpoint base path in both the request and canonical URI', () => {
        const config = createS3Config({ endpoint: 'https://minio.example.com:9000/s3/api/' });

        expect(buildS3Url(config, 'folder/a.png')).toBe(
            'https://minio.example.com:9000/s3/api/images/folder/a.png'
        );
        expect(buildS3CanonicalUri(config, 'folder/a.png')).toBe(
            '/s3/api/images/folder/a.png'
        );
    });

    it('encodes and sorts canonical query values without using plus for spaces', () => {
        expect(buildS3CanonicalQuery([
            ['prefix', 'vault a/中文'],
            ['continuation-token', 'token+/=%2520&value'],
            ['list-type', '2'],
        ])).toBe(
            'continuation-token=token%2B%2F%3D%252520%26value&list-type=2&prefix=vault%20a%2F%E4%B8%AD%E6%96%87'
        );
    });

    it('signs the exact query and only headers that are actually sent', async () => {
        const request = await signS3Request({
            config: createS3Config(),
            method: 'GET',
            key: '',
            query: [['list-type', '2'], ['max-keys', '1']],
            now: new Date('2026-07-18T04:05:06.000Z'),
        });

        expect(request.url).toBe(
            'https://minio.example.com:9000/images/?list-type=2&max-keys=1'
        );
        expect(request.canonicalRequest).toBe([
            'GET',
            '/images/',
            'list-type=2&max-keys=1',
            'host:minio.example.com:9000',
            'x-amz-content-sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
            'x-amz-date:20260718T040506Z',
            '',
            'host;x-amz-content-sha256;x-amz-date',
            'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
        ].join('\n'));
        expect(request.headers).not.toHaveProperty('Content-Type');
        expect(request.headers.Authorization).toContain(
            'Credential=access-key/20260718/us-east-1/s3/aws4_request'
        );
    });

    it('defaults an empty Cloudflare R2 region to auto and rejects other empty regions', async () => {
        const r2 = createS3Config({
            endpoint: 'https://account.eu.r2.cloudflarestorage.com',
            region: '',
        });

        const request = await signS3Request({ config: r2, method: 'GET', key: '' });
        expect(request.headers.Authorization).toContain('/auto/s3/aws4_request');
        await expect(signS3Request({
            config: createS3Config({ region: '' }),
            method: 'GET',
            key: '',
        })).rejects.toThrow('S3 region is required');
    });
});

describe('S3Uploader', () => {
    beforeEach(() => {
        requestUrl.mockReset();
        requestUrl.mockResolvedValue({ status: 200, text: '' });
    });

    it('uses the encoded request path when uploading', async () => {
        const uploader = new S3Uploader(createHostingConfig(createS3Config()));

        const result = await uploader.upload(new ArrayBuffer(0), '中文 图.png');

        const uploadRequest = requestUrl.mock.calls[0]?.[0] as RequestUrlParam | undefined;
        expect(uploadRequest?.url).toBe(
            'https://minio.example.com:9000/images/uploads/%E4%B8%AD%E6%96%87%20%E5%9B%BE.png'
        );
        expect(uploadRequest?.headers?.['Content-Type']).toBe('image/png');
        expect(uploadRequest?.headers?.Authorization).toContain(
            'SignedHeaders=content-type;host;x-amz-content-sha256;x-amz-date'
        );
        expect(result).toMatchObject({
            success: true,
            url: 'https://minio.example.com:9000/images/uploads/%E4%B8%AD%E6%96%87%20%E5%9B%BE.png',
        });
    });

    it('does not add the bucket to a configured public URL prefix', async () => {
        const uploader = new S3Uploader(
            createHostingConfig(createS3Config(), 'https://cdn.example.com/root/')
        );

        const result = await uploader.upload(new ArrayBuffer(0), '中文 图.png');

        expect(result.url).toBe(
            'https://cdn.example.com/root/uploads/%E4%B8%AD%E6%96%87%20%E5%9B%BE.png'
        );
    });

    it('normalizes a scheme-less public access base and preserves its path', async () => {
        const uploader = new S3Uploader(
            createHostingConfig(createS3Config(), 'cdn.example.com/public-bucket/')
        );

        const result = await uploader.upload(new ArrayBuffer(0), 'photo.png');

        expect(result.url).toBe('https://cdn.example.com/public-bucket/uploads/photo.png');
    });

    it('uses the global template and sourceDir when the provider template is empty', async () => {
        const hostingConfig = createHostingConfig(createS3Config());
        hostingConfig.uploadPath = '';
        const uploader = createUploader(
            hostingConfig,
            'global/{sourceDir}/{filename}.{ext}'
        );

        const result = await uploader.upload(new ArrayBuffer(0), '图 1.png', {
            sourcePath: 'Projects/A/图 1.png',
        });

        expect(requestUrl).toHaveBeenCalledWith(expect.objectContaining({
            url: 'https://minio.example.com:9000/images/global/Projects/A/%E5%9B%BE%201.png',
        }));
        expect(result.url).toBe(
            'https://minio.example.com:9000/images/global/Projects/A/%E5%9B%BE%201.png'
        );
    });

    it('tests list capability with one metadata item and no signed content type', async () => {
        const uploader = new S3Uploader(createHostingConfig(createS3Config()));

        await expect(uploader.testConnection()).resolves.toBe(true);

        const request = requestUrl.mock.calls[0]?.[0] as RequestUrlParam | undefined;
        expect(request?.url).toBe('https://minio.example.com:9000/images/?list-type=2&max-keys=1');
        expect(request?.method).toBe('GET');
        expect(request?.headers).not.toHaveProperty('Content-Type');
        expect(request?.headers?.Authorization).toContain(
            'SignedHeaders=host;x-amz-content-sha256;x-amz-date'
        );
    });
});
