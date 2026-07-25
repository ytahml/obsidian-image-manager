import { requestUrl } from 'obsidian';
import { UploaderBase } from './uploader-base';
import { encodeS3Key } from './s3-path';
import { joinPublicUrl } from './public-url';
import { signS3Request } from '../s3/sigv4';
import type { UploadResult, ImageHostingConfig, S3Config, UploadContext } from '../types';

export class S3Uploader extends UploaderBase {
    readonly name = 'S3 Compatible';

    constructor(config: ImageHostingConfig, globalUploadPathTemplate?: string) {
        super(config, globalUploadPathTemplate);
    }

    async upload(
        data: ArrayBuffer,
        filename: string,
        context?: UploadContext
    ): Promise<UploadResult> {
        const s3Config = this.config.config as S3Config;
        const targetPath = await this.resolveUploadPath(filename, data, context);
        const contentType = this.guessMimeType(filename);

        try {
            const request = await signS3Request({
                config: s3Config,
                method: 'PUT',
                key: targetPath,
                body: data,
                contentType,
            });

            const resp = await requestUrl({
                url: request.url,
                method: 'PUT',
                headers: request.headers,
                body: data,
                throw: false,
            });

            if (resp.status >= 400) {
                return {
                    success: false,
                    error: `HTTP ${resp.status}: ${resp.text}`,
                    originalPath: filename,
                };
            }

            const publicUrl = this.config.urlPrefix
                ? joinPublicUrl(this.config.urlPrefix, encodeS3Key(targetPath))
                : request.url;

            return {
                success: true,
                url: publicUrl,
                objectKey: targetPath,
                originalPath: filename,
            };
        } catch (e) {
            return {
                success: false,
                error: e instanceof Error ? e.message : 'Upload failed',
                originalPath: filename,
            };
        }
    }

    async testConnection(): Promise<boolean> {
        const s3Config = this.config.config as S3Config;

        try {
            const request = await signS3Request({
                config: s3Config,
                method: 'GET',
                key: '',
                query: [['list-type', '2'], ['max-keys', '1']],
            });
            const resp = await requestUrl({
                url: request.url,
                method: 'GET',
                headers: request.headers,
                throw: false,
            });
            return resp.status === 200;
        } catch {
            return false;
        }
    }

    private guessMimeType(filename: string): string {
        const ext = filename.split('.').pop()?.toLowerCase() ?? '';
        const map: Record<string, string> = {
            png: 'image/png',
            jpg: 'image/jpeg',
            jpeg: 'image/jpeg',
            gif: 'image/gif',
            webp: 'image/webp',
            svg: 'image/svg+xml',
            bmp: 'image/bmp',
        };
        return map[ext] ?? 'application/octet-stream';
    }
}
