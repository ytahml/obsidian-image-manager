import type { S3Config } from '../types';

export type S3QueryParameter = readonly [name: string, value: string];

export interface S3RequestTarget {
    url: string;
    host: string;
    canonicalUri: string;
    canonicalQuery: string;
}

export interface S3SignRequestOptions {
    config: S3Config;
    method: string;
    key: string;
    query?: readonly S3QueryParameter[];
    body?: ArrayBuffer | Uint8Array;
    contentType?: string;
    now?: Date;
}

export interface S3SignedRequest extends S3RequestTarget {
    headers: Record<string, string>;
    canonicalRequest: string;
}

/** A configuration failure that is safe to show without retaining credentials. */
export class S3RequestConfigurationError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'S3RequestConfigurationError';
    }
}

/** AWS URI encoding for one path or query component. */
export function encodeAwsUriComponent(value: string): string {
    return encodeURIComponent(value).replace(/[!'()*]/g, (character) =>
        `%${character.charCodeAt(0).toString(16).toUpperCase()}`
    );
}

/** Encode an S3 object key while preserving its path separators. */
export function encodeS3Key(key: string): string {
    return key.split('/').map(encodeAwsUriComponent).join('/');
}

/** Encode and sort query pairs exactly as required by Signature Version 4. */
export function buildS3CanonicalQuery(query: readonly S3QueryParameter[] = []): string {
    return query
        .map(([name, value]) => [encodeAwsUriComponent(name), encodeAwsUriComponent(value)] as const)
        .sort(([leftName, leftValue], [rightName, rightValue]) =>
            compareEncoded(leftName, rightName) || compareEncoded(leftValue, rightValue)
        )
        .map(([name, value]) => `${name}=${value}`)
        .join('&');
}

/** Build one URL/canonical-URI pair so the signed path cannot drift from the request path. */
export function buildS3RequestTarget(
    config: S3Config,
    key: string,
    query: readonly S3QueryParameter[] = []
): S3RequestTarget {
    const endpoint = parseS3Endpoint(config.endpoint);
    const endpointPath = trimTrailingSlashes(endpoint.pathname);
    const encodedKey = encodeS3Key(key);
    const bucket = encodeAwsUriComponent(config.bucket.trim());
    if (!bucket) throw new S3RequestConfigurationError('S3 bucket is required.');

    let host: string;
    let canonicalUri: string;
    if (config.forcePathStyle) {
        host = endpoint.host;
        canonicalUri = joinAbsolutePath(endpointPath, bucket, encodedKey);
    } else {
        host = `${config.bucket.trim()}.${endpoint.host}`;
        canonicalUri = joinAbsolutePath(endpointPath, encodedKey);
    }

    const canonicalQuery = buildS3CanonicalQuery(query);
    const url = `${endpoint.protocol}//${host}${canonicalUri}${canonicalQuery ? `?${canonicalQuery}` : ''}`;
    return { url, host, canonicalUri, canonicalQuery };
}

/** Sign an S3 request with the same URL, headers, and canonical fields returned to the caller. */
export async function signS3Request(options: S3SignRequestOptions): Promise<S3SignedRequest> {
    const target = buildS3RequestTarget(options.config, options.key, options.query);
    const now = options.now ?? new Date();
    const amzDate = formatAmzDate(now);
    const dateStamp = formatDateStamp(now);
    const region = resolveS3SigningRegion(options.config);
    const payloadHash = await sha256Hex(options.body ?? new ArrayBuffer(0));

    const signedHeaderValues: Array<readonly [string, string]> = [
        ['host', target.host],
        ['x-amz-content-sha256', payloadHash],
        ['x-amz-date', amzDate],
    ];
    if (options.contentType) signedHeaderValues.push(['content-type', options.contentType]);
    signedHeaderValues.sort(([left], [right]) => compareEncoded(left, right));

    const canonicalHeaders = signedHeaderValues
        .map(([name, value]) => `${name}:${value.trim()}\n`)
        .join('');
    const signedHeaders = signedHeaderValues.map(([name]) => name).join(';');
    const canonicalRequest = [
        options.method.toUpperCase(),
        target.canonicalUri,
        target.canonicalQuery,
        canonicalHeaders,
        signedHeaders,
        payloadHash,
    ].join('\n');

    const credentialScope = `${dateStamp}/${region}/s3/aws4_request`;
    const stringToSign = [
        'AWS4-HMAC-SHA256',
        amzDate,
        credentialScope,
        await sha256Hex(new TextEncoder().encode(canonicalRequest)),
    ].join('\n');
    const signingKey = await getSignatureKey(options.config.secretAccessKey, dateStamp, region);
    const signature = await hmacSha256Hex(signingKey, stringToSign);

    const headers: Record<string, string> = {
        'x-amz-date': amzDate,
        'x-amz-content-sha256': payloadHash,
        Authorization: `AWS4-HMAC-SHA256 Credential=${options.config.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    };
    if (options.contentType) headers['Content-Type'] = options.contentType;

    return { ...target, headers, canonicalRequest };
}

export function resolveS3SigningRegion(config: S3Config): string {
    const region = config.region.trim();
    if (region) return region;

    const endpoint = parseS3Endpoint(config.endpoint);
    if (endpoint.hostname.toLowerCase().endsWith('.r2.cloudflarestorage.com')) return 'auto';
    throw new S3RequestConfigurationError('S3 region is required.');
}

function parseS3Endpoint(value: string): URL {
    const trimmed = value.trim();
    if (!trimmed) throw new S3RequestConfigurationError('S3 endpoint is required.');
    const normalized = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    let endpoint: URL;
    try {
        endpoint = new URL(normalized);
    } catch {
        throw new S3RequestConfigurationError('S3 endpoint is invalid.');
    }
    if (
        (endpoint.protocol !== 'http:' && endpoint.protocol !== 'https:') ||
        endpoint.username || endpoint.password || endpoint.search || endpoint.hash
    ) {
        throw new S3RequestConfigurationError('S3 endpoint must be an HTTP URL without credentials, query, or fragment.');
    }
    return endpoint;
}

function joinAbsolutePath(...parts: string[]): string {
    const normalized = parts
        .map((part) => part.replace(/^\/+|\/+$/g, ''))
        .filter(Boolean);
    if (normalized.length === 0) return '/';
    return `/${normalized.join('/')}${parts[parts.length - 1] === '' ? '/' : ''}`;
}

function trimTrailingSlashes(value: string): string {
    return value.replace(/\/+$/, '');
}

function compareEncoded(left: string, right: string): number {
    if (left === right) return 0;
    return left < right ? -1 : 1;
}

function formatAmzDate(date: Date): string {
    return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

function formatDateStamp(date: Date): string {
    return date.toISOString().slice(0, 10).replace(/-/g, '');
}

async function sha256Hex(data: ArrayBuffer | Uint8Array): Promise<string> {
    const hash = await crypto.subtle.digest('SHA-256', data);
    return hexEncode(new Uint8Array(hash));
}

async function hmacSha256(key: ArrayBuffer | Uint8Array, data: string): Promise<ArrayBuffer> {
    const cryptoKey = await crypto.subtle.importKey(
        'raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
    );
    return crypto.subtle.sign('HMAC', cryptoKey, new TextEncoder().encode(data));
}

async function hmacSha256Hex(key: ArrayBuffer | Uint8Array, data: string): Promise<string> {
    return hexEncode(new Uint8Array(await hmacSha256(key, data)));
}

async function getSignatureKey(secret: string, dateStamp: string, region: string): Promise<ArrayBuffer> {
    const dateKey = await hmacSha256(new TextEncoder().encode(`AWS4${secret}`), dateStamp);
    const regionKey = await hmacSha256(new Uint8Array(dateKey), region);
    const serviceKey = await hmacSha256(new Uint8Array(regionKey), 's3');
    return hmacSha256(new Uint8Array(serviceKey), 'aws4_request');
}

function hexEncode(bytes: Uint8Array): string {
    return Array.from(bytes).map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
