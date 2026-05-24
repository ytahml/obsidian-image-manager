import { requestUrl } from 'obsidian';
import { UploaderBase } from './uploader-base';
import type { UploadResult, ImageHostingConfig, SmmsConfig } from '../types';

export class SmmsUploader extends UploaderBase {
    readonly name = 'SM.MS';

    constructor(config: ImageHostingConfig) {
        super(config);
    }

    async upload(data: ArrayBuffer, filename: string): Promise<UploadResult> {
        const smmsConfig = this.config.config as SmmsConfig;
        const boundary = `----FormBoundary${Date.now()}`;
        const body = this.buildMultipartBody(boundary, data, filename);

        const headers: Record<string, string> = {
            'Content-Type': `multipart/form-data; boundary=${boundary}`,
        };
        if (smmsConfig.token) {
            headers['Authorization'] = smmsConfig.token;
        }

        try {
            const resp = await requestUrl({
                url: 'https://sm.ms/api/v2/upload',
                method: 'POST',
                headers,
                body,
                contentType: 'multipart/form-data',
            });

            const json = resp.json;
            if (json.success) {
                return {
                    success: true,
                    url: json.data.url,
                    originalPath: filename,
                };
            } else {
                // SM.MS returns "Image upload repeated" for duplicates
                if (json.code === 'image_repeated' && json.images) {
                    return {
                        success: true,
                        url: json.images,
                        originalPath: filename,
                    };
                }
                return {
                    success: false,
                    error: json.message ?? 'Upload failed',
                    originalPath: filename,
                };
            }
        } catch (e) {
            return {
                success: false,
                error: e instanceof Error ? e.message : 'Network error',
                originalPath: filename,
            };
        }
    }

    async testConnection(): Promise<boolean> {
        const smmsConfig = this.config.config as SmmsConfig;
        if (!smmsConfig.token) return false;

        try {
            const resp = await requestUrl({
                url: 'https://sm.ms/api/v2/profile',
                method: 'GET',
                headers: { Authorization: smmsConfig.token },
            });
            return resp.status === 200 && resp.json.success;
        } catch {
            return false;
        }
    }

    private buildMultipartBody(boundary: string, data: ArrayBuffer, filename: string): ArrayBuffer {
        const encoder = new TextEncoder();
        const parts: Uint8Array[] = [];

        // File field
        parts.push(encoder.encode(`--${boundary}\r\n`));
        parts.push(encoder.encode(`Content-Disposition: form-data; name="smfile"; filename="${filename}"\r\n`));
        parts.push(encoder.encode(`Content-Type: application/octet-stream\r\n\r\n`));
        parts.push(new Uint8Array(data));
        parts.push(encoder.encode(`\r\n--${boundary}--\r\n`));

        // Combine all parts
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
