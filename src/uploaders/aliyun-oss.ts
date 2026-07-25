import { requestUrl } from 'obsidian';
import { UploaderBase } from './uploader-base';
import { encodeOSSKey } from './oss-path';
import { joinPublicUrl } from './public-url';
import type { UploadResult, ImageHostingConfig, AliyunOSSConfig, UploadContext } from '../types';
import { signOssRequest } from '../oss/sigv4';

export class AliyunOSSUploader extends UploaderBase {
    readonly name = 'Aliyun OSS';

    constructor(config: ImageHostingConfig, globalUploadPathTemplate?: string) {
        super(config, globalUploadPathTemplate);
    }

    async upload(
        data: ArrayBuffer,
        filename: string,
        context?: UploadContext
    ): Promise<UploadResult> {
        const ossConfig = this.config.config as AliyunOSSConfig;
        let template = this.getUploadPathTemplate();
        if (this.config.uploadPath && !template.includes('{filename}')) {
            template = template.replace(/\/?$/, '/{filename}.{ext}');
        }
        const targetPath = await this.resolveUploadPath(filename, data, context, template);
        console.debug(`[AliyunOSS] Uploading to: ${targetPath}`);
        const contentType = this.guessMimeType(filename);
        const encodedPath = encodeOSSKey(targetPath);
        try {
            const signedRequest = await signOssRequest({
                config: ossConfig,
                method: 'PUT',
                key: targetPath,
                contentType,
            });
            const resp = await requestUrl({
                url: signedRequest.url,
                method: 'PUT',
                headers: signedRequest.headers,
                body: data,
                throw: false,
            });

            if (resp.status >= 400) {
                console.error(`[AliyunOSS] Upload failed: HTTP ${resp.status}`, resp.text);
                return { success: false, error: `HTTP ${resp.status}: ${resp.text}`, originalPath: filename };
            }
            const publicUrl = this.config.urlPrefix
                ? joinPublicUrl(this.config.urlPrefix, encodedPath)
                : signedRequest.url;
            return { success: true, url: publicUrl, objectKey: targetPath, originalPath: filename };
        } catch (e) {
            const msg = e instanceof Error ? e.message : 'Upload failed';
            return { success: false, error: msg, originalPath: filename };
        }
    }

    async testConnection(): Promise<boolean> {
        const ossConfig = this.config.config as AliyunOSSConfig;
        try {
            const signedRequest = await signOssRequest({
                config: ossConfig,
                method: 'GET',
                query: [['list-type', '2'], ['max-keys', '1']],
            });
            const resp = await requestUrl({
                url: signedRequest.url,
                method: 'GET',
                headers: signedRequest.headers,
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
