import { requestUrl } from 'obsidian';
import { UploaderBase } from './uploader-base';
import type { UploadResult, ImageHostingConfig, QiniuConfig } from '../types';

export class QiniuUploader extends UploaderBase {
    readonly name = 'Qiniu';

    constructor(config: ImageHostingConfig) {
        super(config);
    }

    async upload(data: ArrayBuffer, filename: string): Promise<UploadResult> {
        const qiniuConfig = this.config.config as QiniuConfig;
        const targetPath = this.resolveUploadPath(filename);
        const token = await this.generateUploadToken(qiniuConfig, targetPath);

        try {
            const boundary = `----FormBoundary${Date.now()}`;
            const body = this.buildMultipartBody(boundary, token, targetPath, data);

            const resp = await requestUrl({
                url: 'https://upload.qiniu.com/',
                method: 'POST',
                headers: {
                    'Content-Type': `multipart/form-data; boundary=${boundary}`,
                },
                body,
            });

            const json = resp.json;
            if (json.key) {
                const publicUrl = `${qiniuConfig.domain}/${json.key}`;
                return {
                    success: true,
                    url: publicUrl,
                    originalPath: filename,
                };
            }

            return {
                success: false,
                error: json.error ?? 'Upload failed',
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
        const qiniuConfig = this.config.config as QiniuConfig;
        try {
            // Test by generating a token
            const token = await this.generateUploadToken(qiniuConfig, 'test');
            return token.length > 0;
        } catch {
            return false;
        }
    }

    private async generateUploadToken(config: QiniuConfig, key: string): Promise<string> {
        const policy = {
            scope: `${config.bucket}:${key}`,
            deadline: Math.floor(Date.now() / 1000) + 3600,
        };
        const encodedPolicy = btoa(JSON.stringify(policy));
        const sign = await this.hmacSha1(config.secretKey, encodedPolicy);
        const encodedSign = btoa(String.fromCharCode(...new Uint8Array(sign))).replace(/\+/g, '-').replace(/\//g, '_');
        return `${config.accessKey}:${encodedSign}:${encodedPolicy}`;
    }

    private async hmacSha1(secret: string, data: string): Promise<ArrayBuffer> {
        const key = await crypto.subtle.importKey(
            'raw',
            new TextEncoder().encode(secret),
            { name: 'HMAC', hash: 'SHA-1' },
            false,
            ['sign']
        );
        return crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data));
    }

    private buildMultipartBody(
        boundary: string,
        token: string,
        key: string,
        data: ArrayBuffer
    ): ArrayBuffer {
        const encoder = new TextEncoder();
        const parts: Uint8Array[] = [];

        // Token field
        parts.push(encoder.encode(`--${boundary}\r\n`));
        parts.push(encoder.encode(`Content-Disposition: form-data; name="token"\r\n\r\n`));
        parts.push(encoder.encode(`${token}\r\n`));

        // Key field
        parts.push(encoder.encode(`--${boundary}\r\n`));
        parts.push(encoder.encode(`Content-Disposition: form-data; name="key"\r\n\r\n`));
        parts.push(encoder.encode(`${key}\r\n`));

        // File field
        parts.push(encoder.encode(`--${boundary}\r\n`));
        parts.push(encoder.encode(`Content-Disposition: form-data; name="file"; filename="${key.split('/').pop()}"\r\n`));
        parts.push(encoder.encode(`Content-Type: application/octet-stream\r\n\r\n`));
        parts.push(new Uint8Array(data));
        parts.push(encoder.encode(`\r\n--${boundary}--\r\n`));

        const totalLength = parts.reduce((sum, p) => sum + p.byteLength, 0);
        const result = new Uint8Array(totalLength);
        let offset = 0;
        for (const part of parts) {
            result.set(part, offset);
            offset += part.byteLength;
        }
        return result.buffer;
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
}
