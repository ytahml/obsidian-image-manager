import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RequestUrlParam } from 'obsidian';
import type { ImageHostingConfig } from '../src/types';

const { requestUrl } = vi.hoisted(() => ({ requestUrl: vi.fn() }));
vi.mock('obsidian', () => ({ requestUrl }));

import { UploadService } from '../src/uploaders/upload-service';
import { ImageOptimizer } from '../src/utils/image-optimizer';

const hosting: ImageHostingConfig = {
    id: 's3-private-test', name: 'S3 private test', type: 's3', enabled: true,
    config: {
        endpoint: 'https://storage.example.invalid', region: 'us-east-1', bucket: 'bucket',
        accessKeyId: 'dummy-access', secretAccessKey: 'dummy-secret', forcePathStyle: true,
    },
    uploadPath: 'uploads/{filename}.{ext}', urlPrefix: 'https://cdn.example.invalid',
};
const file = { name: 'original.png', path: 'assets/original.png', extension: 'png', stat: { size: 8 } } as never;

beforeEach(() => {
    requestUrl.mockReset();
});

afterEach(() => vi.restoreAllMocks());

describe('native upload compression format', () => {
    it('labels the uploaded WebP bytes with a matching MIME type and extension', async () => {
        const compressedWebp = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0x57, 0x45, 0x42, 0x50]).buffer;
        vi.spyOn(ImageOptimizer.prototype, 'compressImage').mockResolvedValue({
            data: compressedWebp, originalSize: 8, optimizedSize: compressedWebp.byteLength, format: 'webp',
        });
        requestUrl.mockResolvedValue({ status: 200, text: '' });
        const app = { vault: { readBinary: vi.fn().mockResolvedValue(new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7]).buffer) } } as never;
        const service = new UploadService(app, () => ({ compressBeforeUpload: true, compressQuality: 80, uploadPathTemplate: '' }));

        const result = await service.uploadFile(file, hosting);
        const request = requestUrl.mock.calls[0]?.[0] as RequestUrlParam;

        expect(result.success).toBe(true);
        expect.soft(request.headers?.['Content-Type']).toBe('image/webp');
        expect(request.body).toBe(compressedWebp);
        expect.soft(new URL(request.url).pathname).toContain('original.webp');
    });
});
