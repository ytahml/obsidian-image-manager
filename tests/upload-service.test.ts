import { describe, expect, it, vi } from 'vitest';
import type { App } from 'obsidian';
import type { ImageHostingConfig, UploadResult } from '../src/types';
import type { UploadDefaults } from '../src/uploaders/upload-service';

const { createUploader } = vi.hoisted(() => ({ createUploader: vi.fn() }));

vi.mock('../src/uploaders/uploader-factory', () => ({ createUploader }));

import { UploadService } from '../src/uploaders/upload-service';
import { summarizeUploadError } from '../src/uploaders/upload-error';

const settings = {
    compressBeforeUpload: false,
    compressQuality: 80,
    uploadPathTemplate: 'uploads/{filename}.{ext}',
} satisfies UploadDefaults;

function hostingConfig(type: ImageHostingConfig['type']): ImageHostingConfig {
    return {
        id: `${type}-hosting`,
        name: type,
        type,
        enabled: true,
        config: type === 'custom'
            ? { uploadUrl: '', method: 'POST', headers: {}, fileFieldName: 'file', jsonPath: '', extraBody: {} }
            : type === 's3'
                ? { endpoint: '', region: '', accessKeyId: '', secretAccessKey: '', bucket: '' }
                : type === 'qiniu'
                    ? { accessKey: '', secretKey: '', bucket: '', region: 'z0' }
                    : { region: '', accessKeyId: '', accessKeySecret: '', bucket: '' },
        uploadPath: '',
        urlPrefix: '',
    };
}

function uploader(...results: UploadResult[]) {
    return { upload: vi.fn(async () => results.shift() ?? results[0]), testConnection: vi.fn() };
}

describe('UploadService', () => {
    it('reads the narrow upload defaults at operation time', async () => {
        const defaults = { ...settings };
        createUploader.mockReturnValue(uploader({
            success: true,
            url: 'https://custom.example/a.png',
            originalPath: 'a.png',
        }));
        const service = new UploadService({} as App, () => defaults);
        defaults.uploadPathTemplate = 'changed/{filename}.{ext}';

        await service.uploadData(new ArrayBuffer(0), 'a.png', hostingConfig('custom'));

        expect(createUploader).toHaveBeenCalledWith(
            expect.objectContaining({ id: 'custom-hosting' }),
            'changed/{filename}.{ext}'
        );
    });

    it('publishes a structured native result only after a URL and object key succeed', async () => {
        const target = uploader({
            success: true,
            url: 'https://cdn.example.com/images/a.png',
            objectKey: 'images/a.png',
            originalPath: 'a.png',
        });
        createUploader.mockReturnValue(target);
        const service = new UploadService({} as App, () => settings);
        const listener = vi.fn();
        service.onSuccess(listener);

        await expect(service.uploadData(new ArrayBuffer(3), 'a.png', hostingConfig('s3'))).resolves.toMatchObject({
            success: true,
            hostingId: 's3-hosting',
            objectKey: 'images/a.png',
            attempts: 1,
            originalSize: 3,
            uploadedSize: 3,
        });
        expect(listener).toHaveBeenCalledTimes(1);
    });

    it('retries only in the orchestration layer and never publishes failures', async () => {
        const target = uploader(
            { success: false, error: 'temporary', originalPath: 'a.png' },
            { success: true, url: 'https://cdn.example.com/a.png', objectKey: 'a.png', originalPath: 'a.png' }
        );
        createUploader.mockReturnValue(target);
        const service = new UploadService({} as App, () => settings);
        const listener = vi.fn();
        service.onSuccess(listener);

        await expect(service.uploadData(new ArrayBuffer(0), 'a.png', hostingConfig('qiniu'), undefined, {
            maxRetries: 1,
        })).resolves.toMatchObject({ success: true, attempts: 2 });
        expect(target.upload).toHaveBeenCalledTimes(2);
        expect(listener).toHaveBeenCalledTimes(1);
    });

    it('stops before a retry when the calling transaction is no longer current', async () => {
        const target = uploader(
            { success: false, error: 'temporary', originalPath: 'a.png' },
            { success: true, url: 'https://cdn.example.com/a.png', objectKey: 'a.png', originalPath: 'a.png' }
        );
        createUploader.mockReturnValue(target);
        const service = new UploadService({} as App, () => settings);
        const beforeAttempt = vi.fn(async (attempt: number) => attempt === 1);

        await expect(service.uploadData(new ArrayBuffer(0), 'a.png', hostingConfig('qiniu'), undefined, {
            maxRetries: 2,
            beforeAttempt,
        })).resolves.toMatchObject({ success: false, attempts: 1, cancelled: true });
        expect(beforeAttempt).toHaveBeenCalledTimes(2);
        expect(target.upload).toHaveBeenCalledTimes(1);
    });

    it('fails closed without throwing when transaction validation itself fails', async () => {
        const target = uploader({
            success: true, url: 'https://cdn.example.com/a.png', objectKey: 'a.png', originalPath: 'a.png',
        });
        createUploader.mockReturnValue(target);
        const service = new UploadService({} as App, () => settings);

        await expect(service.uploadData(new ArrayBuffer(0), 'a.png', hostingConfig('qiniu'), undefined, {
            beforeAttempt: async () => { throw new Error('source deleted'); },
        })).resolves.toMatchObject({ success: false, attempts: 0, cancelled: true });
        expect(target.upload).not.toHaveBeenCalled();
    });

    it('keeps Custom URL-only and rejects a native success that lacks its object key', async () => {
        const service = new UploadService({} as App, () => settings);
        const listener = vi.fn();
        service.onSuccess(listener);
        createUploader.mockReturnValue(uploader({
            success: true, url: 'https://custom.example/a.png', originalPath: 'a.png',
        }));
        const customResult = await service.uploadData(new ArrayBuffer(0), 'a.png', hostingConfig('custom'));
        expect(customResult.success).toBe(true);
        expect(customResult).not.toHaveProperty('objectKey');

        createUploader.mockReturnValue(uploader({
            success: true, url: 'https://cdn.example/a.png', originalPath: 'a.png',
        }));
        await expect(service.uploadData(new ArrayBuffer(0), 'a.png', hostingConfig('aliyun-oss')))
            .resolves.toMatchObject({ success: false });
        expect(listener).toHaveBeenCalledTimes(1);
    });
});

describe('upload error summaries', () => {
    it('keeps the HTTP status and provider code without exposing the response body', () => {
        expect(summarizeUploadError(
            'HTTP 403: <Error><Code>SignatureDoesNotMatch</Code><Message>secret detail</Message></Error>'
        )).toBe('HTTP 403 (SignatureDoesNotMatch)');
    });

    it('returns a concise fallback for empty and non-HTTP failures', () => {
        expect(summarizeUploadError(undefined)).toBe('Unknown error');
        expect(summarizeUploadError(' Network\n request failed ')).toBe('Network request failed');
    });
});
