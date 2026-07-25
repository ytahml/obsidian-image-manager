import type { AliyunOSSConfig } from '../types';
import { encodeOSSKey } from '../uploaders/oss-path';

export type OssQueryParameter = readonly [name: string, value: string];

export interface SignedOssRequest {
    url: string;
    headers: Record<string, string>;
}

export interface PresignedOssRequest {
    url: string;
    expiresAt: number;
}

export class OssRequestConfigurationError extends Error {
    constructor() {
        super('OSS request configuration is invalid.');
        this.name = 'OssRequestConfigurationError';
    }
}

interface OssRequestOptions {
    config: AliyunOSSConfig;
    method: string;
    key?: string;
    query?: readonly OssQueryParameter[];
    contentType?: string;
    now?: Date;
}

interface OssPresignOptions {
    config: AliyunOSSConfig;
    key: string;
    expiresInSeconds: number;
    now?: Date;
}

interface OssRequestTarget {
    url: string;
    host: string;
    canonicalUri: string;
}

/** Build a signed OSS V4 header request without exposing secrets to callers. */
export async function signOssRequest(options: OssRequestOptions): Promise<SignedOssRequest> {
    const target = buildOssRequestTarget(options.config, options.key ?? '');
    const timestamp = formatOssTimestamp(options.now ?? new Date());
    const dateStamp = timestamp.slice(0, 8);
    const region = normalizeOssRegion(options.config.region);
    const canonicalQuery = buildOssCanonicalQuery(options.query ?? []);
    const requiredHeaders: Record<string, string> = {
        'x-oss-content-sha256': 'UNSIGNED-PAYLOAD',
        'x-oss-date': timestamp,
    };
    if (options.contentType) requiredHeaders['content-type'] = options.contentType;
    const canonicalHeaders = Object.entries(requiredHeaders)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([name, value]) => `${name}:${value.trim()}`)
        .join('\n') + '\n';
    const canonicalRequest = [
        options.method,
        target.canonicalUri,
        canonicalQuery,
        canonicalHeaders,
        '',
        'UNSIGNED-PAYLOAD',
    ].join('\n');
    const scope = `${dateStamp}/${region}/oss/aliyun_v4_request`;
    const signature = await signOssCanonicalRequest(options.config.accessKeySecret, region, dateStamp, timestamp, scope, canonicalRequest);
    const querySuffix = canonicalQuery ? `?${canonicalQuery}` : '';
    const headers: Record<string, string> = {
        Authorization: `OSS4-HMAC-SHA256 Credential=${options.config.accessKeyId.trim()}/${scope}, Signature=${signature}`,
        'x-oss-content-sha256': 'UNSIGNED-PAYLOAD',
        'x-oss-date': timestamp,
    };
    if (options.contentType) headers['Content-Type'] = options.contentType;
    return { url: `${target.url}${querySuffix}`, headers };
}

/** Create a short-lived V4 GET URL for a private OSS object. */
export async function presignOssGetRequest(options: OssPresignOptions): Promise<PresignedOssRequest> {
    if (!Number.isInteger(options.expiresInSeconds) || options.expiresInSeconds < 1 || options.expiresInSeconds > 604800) {
        throw new OssRequestConfigurationError();
    }
    const target = buildOssRequestTarget(options.config, options.key);
    const now = options.now ?? new Date();
    const timestamp = formatOssTimestamp(now);
    const dateStamp = timestamp.slice(0, 8);
    const region = normalizeOssRegion(options.config.region);
    const scope = `${dateStamp}/${region}/oss/aliyun_v4_request`;
    const query: OssQueryParameter[] = [
        ['x-oss-additional-headers', 'host'],
        ['x-oss-credential', `${options.config.accessKeyId.trim()}/${scope}`],
        ['x-oss-date', timestamp],
        ['x-oss-expires', String(options.expiresInSeconds)],
        ['x-oss-signature-version', 'OSS4-HMAC-SHA256'],
    ];
    const canonicalQuery = buildOssCanonicalQuery(query);
    const canonicalRequest = [
        'GET',
        target.canonicalUri,
        canonicalQuery,
        `host:${target.host}\n`,
        'host',
        'UNSIGNED-PAYLOAD',
    ].join('\n');
    const signature = await signOssCanonicalRequest(options.config.accessKeySecret, region, dateStamp, timestamp, scope, canonicalRequest);
    const finalQuery = buildOssCanonicalQuery([...query, ['x-oss-signature', signature]]);
    return {
        url: `${target.url}?${finalQuery}`,
        expiresAt: now.getTime() + options.expiresInSeconds * 1000,
    };
}

export function buildOssRequestTarget(config: AliyunOSSConfig, key: string): OssRequestTarget {
    const region = normalizeOssRegion(config.region);
    const bucket = config.bucket.trim();
    if (!bucket || !config.accessKeyId.trim() || !config.accessKeySecret.trim()) {
        throw new OssRequestConfigurationError();
    }
    const host = `${bucket}.oss-${region}.aliyuncs.com`;
    const encodedKey = encodeOSSKey(key.replace(/^\/+/, ''));
    return {
        url: `https://${host}/${encodedKey}`,
        host,
        canonicalUri: `/${bucket}/${encodedKey}`,
    };
}

export function normalizeOssRegion(value: string): string {
    let region = value.trim();
    if (region.includes('.aliyuncs.com')) region = region.replace(/^.*?oss-/, '').replace(/\.aliyuncs\.com.*$/, '');
    if (region.startsWith('oss-')) region = region.slice(4);
    if (!region || /[/?#@\s]/.test(region)) throw new OssRequestConfigurationError();
    return region;
}

export function buildOssCanonicalQuery(query: readonly OssQueryParameter[]): string {
    return query
        .map(([name, value]) => [encodeOssQueryComponent(name), encodeOssQueryComponent(value)] as const)
        .sort(([leftName, leftValue], [rightName, rightValue]) =>
            compareEncoded(leftName, rightName) || compareEncoded(leftValue, rightValue)
        )
        .map(([name, value]) => `${name}=${value}`)
        .join('&');
}

function encodeOssQueryComponent(value: string): string {
    return encodeURIComponent(value).replace(/[!'()*]/g, (character) =>
        `%${character.charCodeAt(0).toString(16).toUpperCase()}`
    );
}

function compareEncoded(left: string, right: string): number {
    if (left === right) return 0;
    return left < right ? -1 : 1;
}

function formatOssTimestamp(date: Date): string {
    if (!Number.isFinite(date.getTime())) throw new OssRequestConfigurationError();
    return date.toISOString().replace(/[:-]|\.\d{3}/g, '');
}

async function signOssCanonicalRequest(
    secret: string,
    region: string,
    dateStamp: string,
    timestamp: string,
    scope: string,
    canonicalRequest: string
): Promise<string> {
    const stringToSign = [
        'OSS4-HMAC-SHA256',
        timestamp,
        scope,
        await sha256Hex(canonicalRequest),
    ].join('\n');
    const signingKey = await getOssSigningKey(secret.trim(), dateStamp, region);
    return hmacSha256Hex(signingKey, stringToSign);
}

async function getOssSigningKey(secret: string, date: string, region: string): Promise<ArrayBuffer> {
    const dateKey = await hmacSha256(new TextEncoder().encode(`aliyun_v4${secret}`), date);
    const regionKey = await hmacSha256(dateKey, region);
    const serviceKey = await hmacSha256(regionKey, 'oss');
    return hmacSha256(serviceKey, 'aliyun_v4_request');
}

async function sha256Hex(value: string): Promise<string> {
    const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
    return Array.from(new Uint8Array(hash)).map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function hmacSha256(key: ArrayBuffer | Uint8Array, value: string): Promise<ArrayBuffer> {
    const cryptoKey = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    return crypto.subtle.sign('HMAC', cryptoKey, new TextEncoder().encode(value));
}

async function hmacSha256Hex(key: ArrayBuffer | Uint8Array, value: string): Promise<string> {
    const signature = await hmacSha256(key, value);
    return Array.from(new Uint8Array(signature)).map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
