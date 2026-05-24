import { requestUrl } from 'obsidian';
import { UploaderBase } from './uploader-base';
import type { UploadResult, ImageHostingConfig, CustomConfig } from '../types';

export class CustomUploader extends UploaderBase {
    readonly name = 'Custom';

    constructor(config: ImageHostingConfig) {
        super(config);
    }

    async upload(data: ArrayBuffer, filename: string): Promise<UploadResult> {
        const customConfig = this.config.config as CustomConfig;

        try {
            const boundary = `----FormBoundary${Date.now()}`;
            const body = this.buildBody(customConfig, boundary, data, filename);

            const headers: Record<string, string> = {
                ...customConfig.headers,
            };

            if (customConfig.method === 'POST' && customConfig.fileFieldName) {
                headers['Content-Type'] = `multipart/form-data; boundary=${boundary}`;
            }

            const resp = await requestUrl({
                url: customConfig.uploadUrl,
                method: customConfig.method,
                headers,
                body,
            });

            const url = this.extractUrl(resp.json, customConfig.jsonPath);
            if (url) {
                return {
                    success: true,
                    url,
                    originalPath: filename,
                };
            }

            return {
                success: false,
                error: 'Could not extract URL from response',
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
        try {
            const customConfig = this.config.config as CustomConfig;
            const resp = await requestUrl({
                url: customConfig.uploadUrl,
                method: 'GET',
                headers: customConfig.headers,
            });
            return resp.status < 400;
        } catch {
            return false;
        }
    }

    private buildBody(
        customConfig: CustomConfig,
        boundary: string,
        data: ArrayBuffer,
        filename: string
    ): ArrayBuffer {
        if (customConfig.method === 'PUT') {
            return data;
        }

        // Build multipart form data
        const encoder = new TextEncoder();
        const parts: Uint8Array[] = [];

        // Extra body fields
        for (const [key, value] of Object.entries(customConfig.extraBody ?? {})) {
            parts.push(encoder.encode(`--${boundary}\r\n`));
            parts.push(encoder.encode(`Content-Disposition: form-data; name="${key}"\r\n\r\n`));
            parts.push(encoder.encode(`${value}\r\n`));
        }

        // File field
        if (customConfig.fileFieldName) {
            parts.push(encoder.encode(`--${boundary}\r\n`));
            parts.push(
                encoder.encode(
                    `Content-Disposition: form-data; name="${customConfig.fileFieldName}"; filename="${filename}"\r\n`
                )
            );
            parts.push(encoder.encode(`Content-Type: application/octet-stream\r\n\r\n`));
            parts.push(new Uint8Array(data));
            parts.push(encoder.encode(`\r\n`));
        }

        parts.push(encoder.encode(`--${boundary}--\r\n`));

        const totalLength = parts.reduce((sum, p) => sum + p.byteLength, 0);
        const result = new Uint8Array(totalLength);
        let offset = 0;
        for (const part of parts) {
            result.set(part, offset);
            offset += part.byteLength;
        }
        return result.buffer;
    }

    private extractUrl(json: unknown, jsonPath: string): string | null {
        if (!jsonPath) return null;

        const parts = jsonPath.split('.');
        let current: unknown = json;

        for (const part of parts) {
            if (current === null || current === undefined || typeof current !== 'object') {
                return null;
            }
            current = (current as Record<string, unknown>)[part];
        }

        return typeof current === 'string' ? current : null;
    }
}
