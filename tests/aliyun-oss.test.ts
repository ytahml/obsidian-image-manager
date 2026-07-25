import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AliyunOSSConfig, ImageHostingConfig } from '../src/types';

const { requestUrl } = vi.hoisted(() => ({ requestUrl: vi.fn() }));

vi.mock('obsidian', () => ({ requestUrl }));

import { AliyunOSSUploader } from '../src/uploaders/aliyun-oss';
import { encodeOSSKey } from '../src/uploaders/oss-path';

const FIXED_DATE = new Date('2026-07-14T06:00:00.000Z');

function createOSSConfig(): AliyunOSSConfig {
    return {
        region: 'cn-hangzhou',
        accessKeyId: 'access-key',
        accessKeySecret: 'secret-key',
        bucket: 'images',
    };
}

function createHostingConfig(urlPrefix = ''): ImageHostingConfig {
    return {
        id: 'aliyun-test',
        name: 'Aliyun test',
        type: 'aliyun-oss',
        enabled: true,
        config: createOSSConfig(),
        uploadPath: 'uploads/{filename}.{ext}',
        urlPrefix,
    };
}

async function hmacSha256(keyData: ArrayBuffer | Uint8Array, value: string): Promise<ArrayBuffer> {
    const key = await crypto.subtle.importKey(
        'raw',
        keyData,
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign']
    );
    return crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value));
}

async function sha256Hex(value: string): Promise<string> {
    const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
    return Array.from(new Uint8Array(hash))
        .map((byte) => byte.toString(16).padStart(2, '0'))
        .join('');
}

async function calculateV4Signature(canonicalRequest: string): Promise<string> {
    const timestamp = '20260714T060000Z';
    const scope = '20260714/cn-hangzhou/oss/aliyun_v4_request';
    const stringToSign = `OSS4-HMAC-SHA256\n${timestamp}\n${scope}\n${await sha256Hex(canonicalRequest)}`;
    const dateKey = await hmacSha256(new TextEncoder().encode('aliyun_v4secret-key'), '20260714');
    const regionKey = await hmacSha256(dateKey, 'cn-hangzhou');
    const serviceKey = await hmacSha256(regionKey, 'oss');
    const signingKey = await hmacSha256(serviceKey, 'aliyun_v4_request');
    const signature = await hmacSha256(signingKey, stringToSign);
    return Array.from(new Uint8Array(signature))
        .map((byte) => byte.toString(16).padStart(2, '0'))
        .join('');
}

describe('Aliyun OSS path construction', () => {
    it('encodes object key segments and preserves path separators', () => {
        expect(encodeOSSKey("folder/中文 图#1?!'()*.png")).toBe(
            'folder/%E4%B8%AD%E6%96%87%20%E5%9B%BE%231%3F%21%27%28%29%2A.png'
        );
        expect(encodeOSSKey('folder/ascii-file.png')).toBe('folder/ascii-file.png');
    });
});

describe('AliyunOSSUploader', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(FIXED_DATE);
        requestUrl.mockReset();
        requestUrl.mockResolvedValue({ status: 200, text: '' });
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('uses an encoded canonical URI and OSS V4 authorization for uploads', async () => {
        const uploader = new AliyunOSSUploader(
            createHostingConfig('https://cdn.example.com/root')
        );
        const filename = '中文 图#1?.png';
        const encodedPath = 'uploads/%E4%B8%AD%E6%96%87%20%E5%9B%BE%231%3F.png';
        const timestamp = '20260714T060000Z';
        const canonicalRequest = [
            'PUT',
            `/images/${encodedPath}`,
            '',
            'content-type:image/png',
            'x-oss-content-sha256:UNSIGNED-PAYLOAD',
            `x-oss-date:${timestamp}`,
            '',
            '',
            'UNSIGNED-PAYLOAD',
        ].join('\n');
        const expectedSignature = await calculateV4Signature(canonicalRequest);

        const result = await uploader.upload(new ArrayBuffer(0), filename);
        const request: unknown = requestUrl.mock.calls[0]?.[0];

        expect(request).toMatchObject({
            url: `https://images.oss-cn-hangzhou.aliyuncs.com/${encodedPath}`,
            headers: {
                Authorization: `OSS4-HMAC-SHA256 Credential=access-key/20260714/cn-hangzhou/oss/aliyun_v4_request, Signature=${expectedSignature}`,
                'Content-Type': 'image/png',
                'x-oss-content-sha256': 'UNSIGNED-PAYLOAD',
                'x-oss-date': timestamp,
            },
        });
        expect(result).toMatchObject({
            success: true,
            url: `https://cdn.example.com/root/${encodedPath}`,
            objectKey: 'uploads/中文 图#1?.png',
        });
    });

    it('normalizes a public access base without changing its bucket path', async () => {
        const uploader = new AliyunOSSUploader(createHostingConfig('cdn.example.com/bucket/'));

        const result = await uploader.upload(new ArrayBuffer(0), 'photo.png');

        expect(result.url).toBe('https://cdn.example.com/bucket/uploads/photo.png');
    });

    it('uses a non-destructive ListObjectsV2 request when testing the bucket connection', async () => {
        const uploader = new AliyunOSSUploader(createHostingConfig());

        await uploader.testConnection();

        const request: unknown = requestUrl.mock.calls[0]?.[0];
        expect(request).toMatchObject({
            url: 'https://images.oss-cn-hangzhou.aliyuncs.com/?list-type=2&max-keys=1',
            method: 'GET',
            headers: {
                'x-oss-content-sha256': 'UNSIGNED-PAYLOAD',
                'x-oss-date': '20260714T060000Z',
            },
        });
        const authorization = (request as { headers: Record<string, string> }).headers.Authorization;
        expect(authorization).toMatch(
            /^OSS4-HMAC-SHA256 Credential=access-key\/20260714\/cn-hangzhou\/oss\/aliyun_v4_request,/
        );
        expect(authorization).not.toContain('AdditionalHeaders=');
        expect(authorization).not.toMatch(/^OSS /);
    });

    it('returns a normal failure for incomplete OSS configuration', async () => {
        const config = createHostingConfig();
        (config.config as AliyunOSSConfig).bucket = '';
        const uploader = new AliyunOSSUploader(config);

        await expect(uploader.upload(new ArrayBuffer(0), 'photo.png'))
            .resolves.toMatchObject({ success: false, originalPath: 'photo.png' });
        await expect(uploader.testConnection()).resolves.toBe(false);
        expect(requestUrl).not.toHaveBeenCalled();
    });

    it('matches the canonical request hash returned by OSS for a real PUT request', async () => {
        const canonicalRequest = [
            'PUT',
            '/obsidain-test/images/2026/07/image-2026-07-14-1784021740469.png',
            '',
            'content-type:image/png',
            'x-oss-content-sha256:UNSIGNED-PAYLOAD',
            'x-oss-date:20260714T093541Z',
            '',
            '',
            'UNSIGNED-PAYLOAD',
        ].join('\n');

        expect(await sha256Hex(canonicalRequest)).toBe(
            '6fe75472c4dc4cd11efc2b165a2ede655100c5e2f5bdc5f648c7dbbddaa14863'
        );
    });
});
