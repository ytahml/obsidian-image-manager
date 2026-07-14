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

async function hmacSha1Base64(value: string, secret: string): Promise<string> {
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
        'raw',
        encoder.encode(secret),
        { name: 'HMAC', hash: 'SHA-1' },
        false,
        ['sign']
    );
    const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(value));
    return btoa(String.fromCharCode(...new Uint8Array(signature)));
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

    it('encodes request and public URLs but signs the logical object key', async () => {
        const uploader = new AliyunOSSUploader(
            createHostingConfig('https://cdn.example.com/root')
        );
        const filename = '中文 图#1?.png';
        const targetPath = `uploads/${filename}`;
        const encodedPath = 'uploads/%E4%B8%AD%E6%96%87%20%E5%9B%BE%231%3F.png';
        const date = FIXED_DATE.toUTCString();
        const stringToSign = `PUT\n\nimage/png\n${date}\n/images/${targetPath}`;
        const expectedSignature = await hmacSha1Base64(stringToSign, 'secret-key');

        const result = await uploader.upload(new ArrayBuffer(0), filename);
        const request: unknown = requestUrl.mock.calls[0]?.[0];

        expect(request).toMatchObject({
            url: `https://images.oss-cn-hangzhou.aliyuncs.com/${encodedPath}`,
            headers: {
                Authorization: `OSS access-key:${expectedSignature}`,
                Date: date,
                'Content-Type': 'image/png',
            },
        });
        expect(result).toMatchObject({
            success: true,
            url: `https://cdn.example.com/root/${encodedPath}`,
        });
    });
});
