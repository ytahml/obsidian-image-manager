import { requestUrl } from 'obsidian';
import { UploaderBase } from './uploader-base';
import { encodePublicPath, joinPublicUrl, normalizePublicUrlBase } from './public-url';
import type { UploadResult, ImageHostingConfig, QiniuConfig, UploadContext } from '../types';
import { createQiniuUploadToken } from '../qiniu/auth';
import { QiniuRemoteObjectProvider } from '../remote/providers/qiniu-remote';

export class QiniuUploader extends UploaderBase {
    readonly name = 'Qiniu';

    constructor(config: ImageHostingConfig, globalUploadPathTemplate?: string) {
        super(config, globalUploadPathTemplate);
    }

    async upload(
        data: ArrayBuffer,
        filename: string,
        context?: UploadContext
    ): Promise<UploadResult> {
        const qiniuConfig = this.config.config as QiniuConfig;
        const publicUrlBase = normalizePublicUrlBase(this.config.urlPrefix);
        if (!publicUrlBase) {
            return {
                success: false,
                error: 'Public access URL base is required for Qiniu',
                originalPath: filename,
            };
        }
        const targetPath = await this.resolveUploadPath(filename, data, context);
        const token = await createQiniuUploadToken(qiniuConfig, targetPath);
        const uploadUrl = this.getUploadUrl(qiniuConfig.region);

        try {
            const boundary = `FormBoundary${Date.now()}`;
            const body = this.buildMultipartBody(boundary, token, targetPath, data);

            const resp = await requestUrl({
                url: uploadUrl,
                method: 'POST',
                headers: {
                    'Content-Type': `multipart/form-data; boundary=${boundary}`,
                },
                body,
                throw: false,
            });

            if (resp.status >= 400) {
                console.error(`[Qiniu] Upload failed: HTTP ${resp.status}`, resp.text);
                return {
                    success: false,
                    error: `HTTP ${resp.status}: ${resp.text}`,
                    originalPath: filename,
                };
            }

            const json = resp.json as { key?: string; error?: string };
            if (json.key) {
                const publicUrl = joinPublicUrl(publicUrlBase, encodePublicPath(json.key));
                return {
                    success: true,
                    url: publicUrl,
                    objectKey: targetPath,
                    originalPath: filename,
                };
            }

            return {
                success: false,
                error: json.error ?? 'Upload failed',
                originalPath: filename,
            };
        } catch (e) {
            console.error('[Qiniu] Upload exception:', e);
            return {
                success: false,
                error: e instanceof Error ? e.message : 'Upload failed',
                originalPath: filename,
            };
        }
    }

    async testConnection(): Promise<boolean> {
        try {
            await new QiniuRemoteObjectProvider(this.config).listObjects({ prefix: '', limit: 1 });
            return true;
        } catch {
            return false;
        }
    }

    private getUploadUrl(region: string): string {
        const endpoints: Record<string, string> = {
            'z0': 'https://upload.qiniu.com/',
            'z1': 'https://up-z1.qiniup.com/',
            'z2': 'https://up-z2.qiniup.com/',
            'na0': 'https://up-na0.qiniup.com/',
            'as0': 'https://up-as0.qiniup.com/',
        };
        const r = (region || 'z0').trim().toLowerCase();
        return endpoints[r] || 'https://upload.qiniu.com/';
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

}
