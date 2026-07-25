import { requestUrl } from 'obsidian';
import { UploaderBase } from './uploader-base';
import { encodeOSSKey } from './oss-path';
import { joinPublicUrl } from './public-url';
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
        const headers = await this.signRequest(ossConfig, 'PUT', targetPath, contentType);

        try {
            const resp = await requestUrl({
                url,
                method: 'PUT',
                headers: {
                    ...headers,
                    'Content-Type': contentType,
                },
                body: data,
                throw: false,
            });

            if (resp.status >= 400) {
                console.error(`[AliyunOSS] Upload failed: HTTP ${resp.status}`, resp.text);
                return { success: false, error: `HTTP ${resp.status}: ${resp.text}`, originalPath: filename };
            }
            const publicUrl = this.config.urlPrefix ? joinPublicUrl(this.config.urlPrefix, encodedPath) : url;
            return { success: true, url: publicUrl, objectKey: targetPath, originalPath: filename };
        } catch (e) {
            const msg = e instanceof Error ? e.message : 'Upload failed';
            return { success: false, error: msg, originalPath: filename };
        }
    }

    async testConnection(): Promise<boolean> {
        const ossConfig = this.config.config as AliyunOSSConfig;
        const region = this.parseRegion(ossConfig.region);
        const host = `${ossConfig.bucket}.oss-${region}.aliyuncs.com`;
        const headers = await this.signRequest(ossConfig, 'GET', '');

        try {
            const resp = await requestUrl({
                url: `https://${host}/`,
                method: 'GET',
                headers,
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

    private async signRequest(
        config: AliyunOSSConfig,
        method: string,
        objectKey: string,
        contentType?: string
    ): Promise<Record<string, string>> {
        const timestamp = this.formatTimestamp(new Date());
        const dateStamp = timestamp.slice(0, 8);
        const region = this.parseRegion(config.region);
        const canonicalUri = objectKey
            ? `/${config.bucket}/${encodeOSSKey(objectKey)}`
            : `/${config.bucket}/`;
        const canonicalHeaders = [
            ...(contentType ? [`content-type:${contentType}`] : []),
            'x-oss-content-sha256:UNSIGNED-PAYLOAD',
            `x-oss-date:${timestamp}`,
        ].join('\n') + '\n';
        const additionalHeaders = '';
        const canonicalRequest = `${method}\n${canonicalUri}\n\n${canonicalHeaders}${additionalHeaders}\n\nUNSIGNED-PAYLOAD`;
        const credentialScope = `${dateStamp}/${region}/oss/aliyun_v4_request`;
        const stringToSign = [
            'OSS4-HMAC-SHA256',
            timestamp,
            credentialScope,
            await this.sha256Hex(canonicalRequest),
        ].join('\n');
        const signingKey = await this.getSigningKey(config.accessKeySecret, dateStamp, region);
        const signature = await this.hmacSha256Hex(signingKey, stringToSign);

        return {
            Authorization: `OSS4-HMAC-SHA256 Credential=${config.accessKeyId}/${credentialScope}, Signature=${signature}`,
            'x-oss-content-sha256': 'UNSIGNED-PAYLOAD',
            'x-oss-date': timestamp,
        };
    }

    private formatTimestamp(date: Date): string {
        return date.toISOString().replace(/[:-]|\.\d{3}/g, '');
    }

    private async sha256Hex(value: string): Promise<string> {
        const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
        return Array.from(new Uint8Array(hash))
            .map((byte) => byte.toString(16).padStart(2, '0'))
            .join('');
    }

    private async getSigningKey(secret: string, date: string, region: string): Promise<ArrayBuffer> {
        const dateKey = await this.hmacSha256(new TextEncoder().encode(`aliyun_v4${secret}`), date);
        const regionKey = await this.hmacSha256(dateKey, region);
        const serviceKey = await this.hmacSha256(regionKey, 'oss');
        return this.hmacSha256(serviceKey, 'aliyun_v4_request');
    }

    private async hmacSha256(key: ArrayBuffer | Uint8Array, value: string): Promise<ArrayBuffer> {
        const cryptoKey = await crypto.subtle.importKey(
            'raw',
            key,
            { name: 'HMAC', hash: 'SHA-256' },
            false,
            ['sign']
        );
        return crypto.subtle.sign('HMAC', cryptoKey, new TextEncoder().encode(value));
    }

    private async hmacSha256Hex(key: ArrayBuffer | Uint8Array, value: string): Promise<string> {
        const signature = await this.hmacSha256(key, value);
        return Array.from(new Uint8Array(signature))
            .map((byte) => byte.toString(16).padStart(2, '0'))
            .join('');
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
