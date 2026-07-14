import { requestUrl } from 'obsidian';
import { UploaderBase } from './uploader-base';
import { encodeOSSKey } from './oss-path';
import type { UploadResult, ImageHostingConfig, AliyunOSSConfig, UploadContext } from '../types';

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
        const region = this.parseRegion(ossConfig.region);
        const host = `${ossConfig.bucket}.oss-${region}.aliyuncs.com`;
        const encodedPath = encodeOSSKey(targetPath);
        const url = `https://${host}/${encodedPath}`;
        const date = new Date().toUTCString();
        // OSS V1 signs the logical object key, while the request URL uses its encoded form.
        const resourcePath = `/${ossConfig.bucket}/${targetPath}`;
        const stringToSign = `PUT\n\n${contentType}\n${date}\n${resourcePath}`;
        const signature = await this.hmacSha1Base64(stringToSign, ossConfig.accessKeySecret);

        try {
            const resp = await requestUrl({
                url,
                method: 'PUT',
                headers: {
                    Authorization: `OSS ${ossConfig.accessKeyId}:${signature}`,
                    Date: date,
                    'Content-Type': contentType,
                },
                body: data,
                throw: false,
            });

            if (resp.status >= 400) {
                console.error(`[AliyunOSS] Upload failed: HTTP ${resp.status}`, resp.text);
                return { success: false, error: `HTTP ${resp.status}: ${resp.text}`, originalPath: filename };
            }
            const publicUrl = this.config.urlPrefix
                ? `${this.config.urlPrefix}/${encodedPath}`
                : url;
            return { success: true, url: publicUrl, originalPath: filename };
        } catch (e) {
            const msg = e instanceof Error ? e.message : 'Upload failed';
            return { success: false, error: msg, originalPath: filename };
        }
    }

    async testConnection(): Promise<boolean> {
        const ossConfig = this.config.config as AliyunOSSConfig;
        const region = this.parseRegion(ossConfig.region);
        const host = `${ossConfig.bucket}.oss-${region}.aliyuncs.com`;
        const date = new Date().toUTCString();
        const resourcePath = `/${ossConfig.bucket}/`;
        const stringToSign = `GET\n\n\n${date}\n${resourcePath}`;
        const signature = await this.hmacSha1Base64(stringToSign, ossConfig.accessKeySecret);

        try {
            const resp = await requestUrl({
                url: `https://${host}/`,
                method: 'GET',
                headers: {
                    Authorization: `OSS ${ossConfig.accessKeyId}:${signature}`,
                    Date: date,
                },
                throw: false,
            });
            return resp.status === 200;
        } catch {
            return false;
        }
    }

    private parseRegion(region: string): string {
        let r = region.trim();
        if (r.includes('.aliyuncs.com')) r = r.replace('.aliyuncs.com', '');
        if (r.startsWith('oss-')) r = r.substring(4);
        return r;
    }

    private async hmacSha1Base64(stringToSign: string, secret: string): Promise<string> {
        const encoder = new TextEncoder();
        const key = await crypto.subtle.importKey(
            'raw',
            encoder.encode(secret),
            { name: 'HMAC', hash: 'SHA-1' },
            false,
            ['sign'],
        );
        const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(stringToSign));
        return btoa(String.fromCharCode(...new Uint8Array(sig)));
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
