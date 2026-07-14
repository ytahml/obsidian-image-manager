import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ImageHostingConfig, QiniuConfig } from '../src/types';

const { requestUrl } = vi.hoisted(() => ({ requestUrl: vi.fn() }));

vi.mock('obsidian', () => ({ requestUrl }));

import { QiniuUploader } from '../src/uploaders/qiniu';

function createHostingConfig(urlPrefix = 'cdn.example.com/bucket/'): ImageHostingConfig {
    const config: QiniuConfig = {
        accessKey: 'access-key',
        secretKey: 'secret-key',
        bucket: 'images',
        region: 'z0',
    };
    return {
        id: 'qiniu-test',
        name: 'Qiniu test',
        type: 'qiniu',
        enabled: true,
        config,
        uploadPath: '',
        urlPrefix,
    };
}

describe('QiniuUploader', () => {
    beforeEach(() => {
        requestUrl.mockReset();
        requestUrl.mockResolvedValue({
            status: 200,
            json: { key: 'global/Projects/A/中文 图#1?.png' },
            text: '',
        });
    });

    it('uses the logical template path in multipart data and encodes the public URL', async () => {
        const uploader = new QiniuUploader(
            createHostingConfig(),
            'global/{sourceDir}/{filename}.{ext}'
        );

        const result = await uploader.upload(new ArrayBuffer(0), '中文 图#1?.png', {
            sourcePath: 'Projects/A/中文 图#1?.png',
        });

        const request = requestUrl.mock.calls[0]?.[0] as { body: ArrayBuffer };
        const body = new TextDecoder().decode(request.body);
        expect(body).toContain('global/Projects/A/中文 图#1?.png');
        expect(result.url).toBe(
            'https://cdn.example.com/bucket/global/Projects/A/%E4%B8%AD%E6%96%87%20%E5%9B%BE%231%3F.png'
        );
    });

    it('fails before uploading when the public access URL base is missing', async () => {
        const uploader = new QiniuUploader(createHostingConfig(''));

        const result = await uploader.upload(new ArrayBuffer(0), 'photo.png');

        expect(result).toMatchObject({
            success: false,
            error: 'Public access URL base is required for Qiniu',
        });
        expect(requestUrl).not.toHaveBeenCalled();
    });
});
