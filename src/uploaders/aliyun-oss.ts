import { requestUrl } from 'obsidian';
import { UploaderBase } from './uploader-base';
import type { UploadResult, ImageHostingConfig, AliyunOSSConfig } from '../types';

export class AliyunOSSUploader extends UploaderBase {
    readonly name = 'Aliyun OSS';

    constructor(config: ImageHostingConfig) {
        super(config);
    }

    async upload(data: ArrayBuffer, filename: string): Promise<UploadResult> {
        const ossConfig = this.config.config as AliyunOSSConfig;
        const targetPath = this.resolveUploadPath(filename);
        const contentType = this.guessMimeType(filename);
        const date = new Date().toUTCString();

        const resourcePath = `/${ossConfig.bucket}/${targetPath}`;
        const stringToSign = `PUT\n\n${contentType}\n${date}\n${resourcePath}`;
        const signature = await this.sign(stringToSign, ossConfig.accessKeySecret);

        const url = `https://${ossConfig.bucket}.${ossConfig.region}.aliyuncs.com/${targetPath}`;

        try {
            await requestUrl({
                url,
                method: 'PUT',
                headers: {
                    Authorization: `OSS ${ossConfig.accessKeyId}:${signature}`,
                    Date: date,
                    'Content-Type': contentType,
                },
                body: data,
            });

            // Construct public URL
            const publicUrl = this.config.urlPrefix
                ? `${this.config.urlPrefix}/${targetPath}`
                : url;

            return {
                success: true,
                url: publicUrl,
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
        const ossConfig = this.config.config as AliyunOSSConfig;
        const date = new Date().toUTCString();
        const resourcePath = `/${ossConfig.bucket}/`;
        const stringToSign = `GET\n\n\n${date}\n${resourcePath}`;
        const signature = await this.sign(stringToSign, ossConfig.accessKeySecret);

        try {
            const resp = await requestUrl({
                url: `https://${ossConfig.bucket}.${ossConfig.region}.aliyuncs.com/`,
                method: 'GET',
                headers: {
                    Authorization: `OSS ${ossConfig.accessKeyId}:${signature}`,
                    Date: date,
                },
            });
            return resp.status === 200;
        } catch {
            return false;
        }
    }

    private async sign(stringToSign: string, secret: string): Promise<string> {
        const encoder = new TextEncoder();
        const key = await crypto.subtle.importKey(
            'raw',
            encoder.encode(secret),
            { name: 'HMAC', hash: 'SHA-1' },
            false,
            ['sign']
        );
        const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(stringToSign));
        return btoa(String.fromCharCode(...new Uint8Array(sig)));
    }

    private resolveUploadPath(filename: string): string {
        const now = new Date();
        const vars: Record<string, string> = {
            year: now.getFullYear().toString(),
            month: String(now.getMonth() + 1).padStart(2, '0'),
            day: String(now.getDate()).padStart(2, '0'),
            filename: filename.replace(/\.[^.]+$/, ''),
            ext: filename.split('.').pop() ?? '',
            timestamp: Math.floor(now.getTime() / 1000).toString(),
        };

        let template = this.config.uploadPath || 'images/{year}/{month}/{filename}.{ext}';
        for (const [key, value] of Object.entries(vars)) {
            template = template.replace(new RegExp(`\\{${key}\\}`, 'g'), value);
        }
        return template;
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
