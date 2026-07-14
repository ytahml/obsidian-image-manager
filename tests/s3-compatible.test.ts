import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ImageHostingConfig, S3Config } from '../src/types';

const { requestUrl } = vi.hoisted(() => ({ requestUrl: vi.fn() }));

vi.mock('obsidian', () => ({ requestUrl }));

import { S3Uploader } from '../src/uploaders/s3-compatible';
import { buildS3CanonicalUri, buildS3Url } from '../src/uploaders/s3-path';

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
});

describe('S3Uploader', () => {
    beforeEach(() => {
        requestUrl.mockReset();
        requestUrl.mockResolvedValue({ status: 200, text: '' });
    });

    it('uses the encoded request path when uploading', async () => {
        const uploader = new S3Uploader(createHostingConfig(createS3Config()));

        const result = await uploader.upload(new ArrayBuffer(0), '中文 图.png');

        expect(requestUrl).toHaveBeenCalledWith(expect.objectContaining({
            url: 'https://minio.example.com:9000/images/uploads/%E4%B8%AD%E6%96%87%20%E5%9B%BE.png',
        }));
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
});
