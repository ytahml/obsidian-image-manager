import type { S3Config } from '../types';

function normalizeEndpoint(endpoint: string): string {
    const normalized = /^https?:\/\//i.test(endpoint) ? endpoint : `https://${endpoint}`;
    return normalized.replace(/\/+$/, '');
}

/** Encode each S3 key segment while preserving path separators. */
export function encodeS3Key(key: string): string {
    return key
        .split('/')
        .map((segment) => encodeURIComponent(segment).replace(/[!'()*]/g, (character) =>
            `%${character.charCodeAt(0).toString(16).toUpperCase()}`
        ))
        .join('/');
}

/** Build the request URL for path-style and virtual-hosted-style S3 endpoints. */
export function buildS3Url(s3Config: S3Config, key: string): string {
    const endpoint = normalizeEndpoint(s3Config.endpoint);
    const encodedKey = encodeS3Key(key);

    if (s3Config.forcePathStyle) {
        return `${endpoint}/${s3Config.bucket}/${encodedKey}`;
    }

    const endpointUrl = new URL(endpoint);
    const endpointPath = endpointUrl.pathname.replace(/\/+$/, '');
    return `${endpointUrl.protocol}//${s3Config.bucket}.${endpointUrl.host}${endpointPath}/${encodedKey}`;
}

/** Build the encoded URI that must match the path used by AWS Signature V4. */
export function buildS3CanonicalUri(s3Config: S3Config, key: string): string {
    const encodedKey = encodeS3Key(key);
    return s3Config.forcePathStyle
        ? `/${s3Config.bucket}/${encodedKey}`
        : `/${encodedKey}`;
}
