import { requestUrl } from 'obsidian';
import { UploaderBase } from './uploader-base';
import { buildS3CanonicalUri, buildS3Url, encodeS3Key } from './s3-path';
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
            const url = buildS3Url(s3Config, targetPath);
            const requestHost = new URL(url).host;
            const headers = await this.signRequest(s3Config, 'PUT', targetPath, requestHost, data, contentType);

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
                return {
                    success: false,
                    error: `HTTP ${resp.status}: ${resp.text}`,
                    originalPath: filename,
                };
            }

            const publicUrl = this.config.urlPrefix
                ? `${this.config.urlPrefix.replace(/\/+$/, '')}/${encodeS3Key(targetPath)}`
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
        const s3Config = this.config.config as S3Config;

        try {
            const url = buildS3Url(s3Config, '');
            const requestHost = new URL(url).host;
            const headers = await this.signRequest(s3Config, 'GET', '', requestHost, new ArrayBuffer(0));
            const resp = await requestUrl({
                url,
                method: 'GET',
                headers,
                throw: false,
            });
            return resp.status === 200;
        } catch {
            return false;
        }
    }

    private async signRequest(
        s3Config: S3Config,
        method: string,
        key: string,
        requestHost: string,
        body: ArrayBuffer,
        contentType = 'application/octet-stream'
    ): Promise<Record<string, string>> {
        const now = new Date();
        const amzDate = this.formatAmzDate(now);
        const dateStamp = this.formatDateStamp(now);
        const payloadHash = await this.sha256Hex(body);

        const canonicalHeaders = `content-type:${contentType}\nhost:${requestHost}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzDate}\n`;
        const signedHeaders = 'content-type;host;x-amz-content-sha256;x-amz-date';

        const canonicalUri = buildS3CanonicalUri(s3Config, key);
        const canonicalRequest = [
            method,
            canonicalUri,
            '', // query string
            canonicalHeaders,
            signedHeaders,
            payloadHash,
        ].join('\n');

        const credentialScope = `${dateStamp}/${s3Config.region}/s3/aws4_request`;
        const stringToSign = [
            'AWS4-HMAC-SHA256',
            amzDate,
            credentialScope,
            await this.sha256Hex(new TextEncoder().encode(canonicalRequest)),
        ].join('\n');

        const signingKey = await this.getSignatureKey(s3Config.secretAccessKey, dateStamp, s3Config.region, 's3');
        const signature = await this.hmacSha256Hex(signingKey, stringToSign);

        const authorization = `AWS4-HMAC-SHA256 Credential=${s3Config.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

        return {
            'x-amz-date': amzDate,
            'x-amz-content-sha256': payloadHash,
            Authorization: authorization,
        };
    }

    private async sha256Hex(data: ArrayBuffer | Uint8Array): Promise<string> {
        const hash = await crypto.subtle.digest('SHA-256', data);
        return this.hexEncode(new Uint8Array(hash));
    }

    private async hmacSha256(key: ArrayBuffer | Uint8Array, data: string): Promise<ArrayBuffer> {
        const cryptoKey = await crypto.subtle.importKey(
            'raw',
            key,
            { name: 'HMAC', hash: 'SHA-256' },
            false,
            ['sign']
        );
        return crypto.subtle.sign('HMAC', cryptoKey, new TextEncoder().encode(data));
    }

    private async hmacSha256Hex(key: ArrayBuffer | Uint8Array, data: string): Promise<string> {
        const sig = await this.hmacSha256(key, data);
        return this.hexEncode(new Uint8Array(sig));
    }

    private async getSignatureKey(
        secret: string,
        dateStamp: string,
        region: string,
        service: string
    ): Promise<ArrayBuffer> {
        const kDate = await this.hmacSha256(new TextEncoder().encode(`AWS4${secret}`), dateStamp);
        const kRegion = await this.hmacSha256(new Uint8Array(kDate), region);
        const kService = await this.hmacSha256(new Uint8Array(kRegion), service);
        const kSigning = await this.hmacSha256(new Uint8Array(kService), 'aws4_request');
        return kSigning;
    }

    private hexEncode(bytes: Uint8Array): string {
        return Array.from(bytes)
            .map((b) => b.toString(16).padStart(2, '0'))
            .join('');
    }

    private formatAmzDate(date: Date): string {
        return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
    }

    private formatDateStamp(date: Date): string {
        return date.toISOString().slice(0, 10).replace(/-/g, '');
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
