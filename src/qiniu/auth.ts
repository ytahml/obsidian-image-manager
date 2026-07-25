import type { QiniuConfig } from '../types';

export function qiniuBase64UrlEncode(input: string | Uint8Array | ArrayBuffer): string {
    const bytes = input instanceof ArrayBuffer
        ? new Uint8Array(input)
        : typeof input === 'string' ? new TextEncoder().encode(input) : input;
    return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_');
}

export async function qiniuHmacSha1(secret: string, value: string): Promise<ArrayBuffer> {
    const key = await crypto.subtle.importKey(
        'raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']
    );
    return crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value));
}

export async function createQiniuUploadToken(config: QiniuConfig, key: string): Promise<string> {
    const policy = JSON.stringify({
        scope: `${config.bucket.trim()}:${key}`,
        deadline: Math.floor(Date.now() / 1000) + 3600,
    });
    const encodedPolicy = qiniuBase64UrlEncode(policy);
    const signature = qiniuBase64UrlEncode(await qiniuHmacSha1(config.secretKey.trim(), encodedPolicy));
    return `${config.accessKey.trim()}:${signature}:${encodedPolicy}`;
}

export function formatQiniuDate(date: Date): string {
    return date.toISOString().replace(/[:-]|\.\d{3}/g, '');
}

export async function createQiniuManagementHeaders(
    config: QiniuConfig,
    method: string,
    url: URL,
    date: Date
): Promise<Record<string, string>> {
    const contentType = 'application/x-www-form-urlencoded';
    const qiniuDate = formatQiniuDate(date);
    const pathAndQuery = `${url.pathname}${url.search}`;
    const signingString = [
        `${method} ${pathAndQuery}`,
        `Host: ${url.host}`,
        `Content-Type: ${contentType}`,
        `X-Qiniu-Date: ${qiniuDate}`,
        '',
    ].join('\n');
    const signature = qiniuBase64UrlEncode(await qiniuHmacSha1(config.secretKey.trim(), signingString));
    return {
        Authorization: `Qiniu ${config.accessKey.trim()}:${signature}`,
        'Content-Type': contentType,
        'X-Qiniu-Date': qiniuDate,
    };
}

export async function createQiniuPrivateDownloadUrl(
    config: QiniuConfig,
    publicUrl: string,
    expiresAt: number
): Promise<string> {
    const separator = publicUrl.includes('?') ? '&' : '?';
    const expiringUrl = `${publicUrl}${separator}e=${expiresAt}`;
    const signature = qiniuBase64UrlEncode(await qiniuHmacSha1(config.secretKey.trim(), expiringUrl));
    return `${expiringUrl}&token=${config.accessKey.trim()}:${signature}`;
}

export function encodeQiniuEntryUri(bucket: string, key: string): string {
    return qiniuBase64UrlEncode(`${bucket.trim()}:${key}`);
}
