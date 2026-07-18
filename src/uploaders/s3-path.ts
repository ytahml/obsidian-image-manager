import type { S3Config } from '../types';
import { buildS3RequestTarget } from '../s3/sigv4';

export { encodeS3Key } from '../s3/sigv4';

/** Build the request URL for path-style and virtual-hosted-style S3 endpoints. */
export function buildS3Url(s3Config: S3Config, key: string): string {
    return buildS3RequestTarget(s3Config, key).url;
}

/** Build the encoded URI that must match the path used by AWS Signature V4. */
export function buildS3CanonicalUri(s3Config: S3Config, key: string): string {
    return buildS3RequestTarget(s3Config, key).canonicalUri;
}
