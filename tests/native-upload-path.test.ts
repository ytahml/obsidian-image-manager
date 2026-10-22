import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RequestUrlParam } from 'obsidian';
import type { ImageHostingConfig } from '../src/types';
import { createUploader } from '../src/uploaders/uploader-factory';

const { requestUrl } = vi.hoisted(() => ({ requestUrl: vi.fn() }));
vi.mock('obsidian', () => ({ requestUrl }));

const providers: ImageHostingConfig[] = [
    {
        id: 'oss', name: 'OSS', type: 'aliyun-oss', enabled: true,
        config: { region: 'cn-hangzhou', bucket: 'images', accessKeyId: 'test', accessKeySecret: 'test' },
        uploadPath: '', urlPrefix: 'https://cdn.example.com/base',
    },
    {
        id: 's3', name: 'S3', type: 's3', enabled: true,
        config: { endpoint: 'https://s3.example.com', region: 'us-east-1', bucket: 'images', accessKeyId: 'test', secretAccessKey: 'test', forcePathStyle: true },
        uploadPath: '', urlPrefix: 'https://cdn.example.com/base',
    },
    {
        id: 'qiniu', name: 'Qiniu', type: 'qiniu', enabled: true,
        config: { region: 'z0', bucket: 'images', accessKey: 'test', secretKey: 'test' },
        uploadPath: '', urlPrefix: 'https://cdn.example.com/base',
    },
];

beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 6, 14, 12));
    requestUrl.mockReset();
    requestUrl.mockImplementation((request: RequestUrlParam) => {
        // Echo the actual multipart key, as Qiniu does on successful upload.
        const key = request.body instanceof ArrayBuffer
            ? new TextDecoder().decode(request.body).match(/name="key"\r\n\r\n([^\r\n]*)\r\n/)?.[1]
            : undefined;
        return { status: 200, text: '', json: { key } };
    });
});

afterEach(() => vi.useRealTimers());

describe.each(providers)('$name upload path contract', (config) => {
    const templates = [
        { template: 'images-obsidian/{year}/{hash}.{ext}', key: 'images-obsidian/2026/e3b0c44298fc1c14.png' },
        { template: 'images/{timestamp}.{ext}', key: `images/${Math.floor(new Date(2026, 6, 14, 12).getTime() / 1000)}.png` },
        { template: 'images/{filename}.{ext}', key: 'images/photo.png' },
        { template: '图片 #/{sourceDir}/{hash}.{ext}', key: '图片 #/notes/assets/e3b0c44298fc1c14.png' },
        { template: 'images/fixed.png', key: 'images/fixed.png' },
        { template: 'images', key: 'images' },
    ];

    async function checkUpload(
        uploadPath: string, globalTemplate: string, key: string, filename = 'photo.png'
    ) {
        const uploader = createUploader({ ...config, uploadPath }, globalTemplate);
        const result = await uploader.upload(new ArrayBuffer(0), filename, {
            sourcePath: `notes/assets/${filename}`,
        });
        const encodedKey = key.split('/').map(encodeURIComponent).join('/');
        expect(result).toMatchObject({ success: true, objectKey: key, url: `https://cdn.example.com/base/${encodedKey}` });
        expect(requestUrl).toHaveBeenCalledTimes(1);
        const request = requestUrl.mock.calls[0]?.[0] as RequestUrlParam;
        if (config.type === 'qiniu') {
            expect(new TextDecoder().decode(request.body as ArrayBuffer)).toContain(`name="key"\r\n\r\n${key}\r\n`);
        } else {
            expect(new URL(request.url).pathname).toBe(`${config.type === 's3' ? '/images' : ''}/${encodedKey}`);
        }
    }

    it.each(templates)('uses provider template literally: $template', async ({ template, key }) => {
        await checkUpload(template, 'ignored/{filename}.{ext}', key);
    });

    it.each(templates)('uses the same global template behavior: $template', async ({ template, key }) => {
        await checkUpload('', template, key);
    });

    it('falls back to the default hash template', async () => {
        await checkUpload('', '', 'images/2026/07/e3b0c44298fc1c14.png');
    });

    it('preserves literal filename characters in the object key, request, and public URL', async () => {
        await checkUpload('images/{filename}.{ext}', '', 'images/photo$&-{ext}.png', 'photo$&-{ext}.png');
    });
});

it('keeps Custom HTTP response URLs independent of object key templates', async () => {
    const url = 'https://custom.example.com/server-chosen.png';
    requestUrl.mockResolvedValue({ status: 200, json: { url } });
    const uploader = createUploader({
        id: 'custom', name: 'Custom', type: 'custom', enabled: true,
        config: { uploadUrl: 'https://custom.example.com/upload', method: 'PUT', headers: {}, fileFieldName: 'file', jsonPath: 'url', extraBody: {} },
        uploadPath: 'ignored/{hash}.{ext}', urlPrefix: 'https://ignored.example.com',
    }, 'also-ignored/{filename}.{ext}');
    const result = await uploader.upload(new ArrayBuffer(0), 'photo.png');
    expect(result).toMatchObject({ success: true, url });
    expect(result).not.toHaveProperty('objectKey');
    expect(requestUrl).toHaveBeenCalledWith(expect.objectContaining({ url: 'https://custom.example.com/upload', method: 'PUT' }));
});
