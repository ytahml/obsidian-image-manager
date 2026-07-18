import type { ImageHostingConfig, S3Config } from '../../types';
import { getRemoteManagementConfig } from '../management-settings';
import { RemoteProviderError, codeForHttpStatus, sanitizeRemoteEndpoint } from '../errors';
import { RemoteRequestClient } from '../request';
import type { RemoteObjectProvider } from '../provider';
import type {
    RemoteDeleteFailureCode,
    RemoteDeleteResult,
    RemoteFolderListPage,
    RemoteFolderListRequest,
    RemoteListPage,
    RemoteListRequest,
    RemoteObject,
    RemotePreviewUrl,
    RemoteUrlMapping,
} from '../types';
import {
    S3RequestConfigurationError,
    buildS3RequestTarget,
    presignS3GetRequest,
    signS3Request,
    type S3QueryParameter,
} from '../../s3/sigv4';
import {
    encodePublicPath,
    joinPublicUrl,
    normalizePublicUrlBase,
} from '../../uploaders/public-url';

export type S3XmlDocumentParser = (xml: string) => Document;

const S3_CAPABILITIES = new Set<'list' | 'folders' | 'preview' | 'delete'>([
    'list',
    'folders',
    'preview',
    'delete',
]);

/** Metadata-only S3-compatible remote provider. */
export class S3RemoteObjectProvider implements RemoteObjectProvider {
    readonly capabilities = S3_CAPABILITIES;
    readonly referenceMapping: RemoteUrlMapping;
    private readonly s3Config: S3Config;

    constructor(
        private readonly hostingConfig: ImageHostingConfig,
        private readonly requestClient = new RemoteRequestClient(),
        private readonly parseXml: S3XmlDocumentParser = parseXmlDocument,
        private readonly now: () => Date = () => new Date()
    ) {
        this.s3Config = hostingConfig.config as S3Config;
        this.referenceMapping = buildS3ReferenceMapping(hostingConfig);
    }

    async listObjects(request: RemoteListRequest): Promise<RemoteListPage> {
        const query = buildListQuery(request);
        const xml = await this.requestList(query);
        return parseS3ListObjectsV2(xml, this.hostingConfig.id, this.parseXml);
    }

    async listFolders(request: RemoteFolderListRequest): Promise<RemoteFolderListPage> {
        const query = buildListQuery({ ...request, delimiter: '/' });
        const xml = await this.requestList(query);
        const page = parseS3ListFolders(xml, this.parseXml);
        if (page.prefixes.some((prefix) => !isDirectChildPrefix(prefix, request.prefix))) {
            throw new RemoteProviderError('parsing');
        }
        return page;
    }

    private async requestList(query: S3QueryParameter[]): Promise<string> {
        let signedRequest;
        try {
            signedRequest = await signS3Request({
                config: this.s3Config,
                method: 'GET',
                key: '',
                query,
                now: this.now(),
            });
        } catch (error) {
            if (error instanceof S3RequestConfigurationError) {
                throw new RemoteProviderError('configuration');
            }
            throw error;
        }

        const response = await this.requestClient.request({
            url: signedRequest.url,
            method: 'GET',
            headers: signedRequest.headers,
            throw: false,
        });
        if (response.status >= 400) {
            throw mapS3ResponseError(
                response.status,
                response.text,
                signedRequest.url,
                this.parseXml
            );
        }

        return response.text;
    }

    async createPreviewUrl(object: RemoteObject): Promise<RemotePreviewUrl> {
        const settings = getRemoteManagementConfig(this.hostingConfig);
        if (settings.previewAccess === 'public') {
            const base = normalizePublicUrlBase(this.hostingConfig.urlPrefix);
            if (!base) throw new RemoteProviderError('configuration');
            return {
                url: joinPublicUrl(base, encodePublicPath(object.key)),
                access: 'public',
            };
        }

        try {
            const preview = await presignS3GetRequest({
                config: this.s3Config,
                key: object.key,
                expiresInSeconds: 300,
                now: this.now(),
            });
            return {
                url: preview.url,
                access: 'presigned',
                expiresAt: preview.expiresAt,
            };
        } catch (error) {
            if (error instanceof S3RequestConfigurationError) {
                throw new RemoteProviderError('configuration');
            }
            throw error;
        }
    }

    async deleteObject(object: RemoteObject): Promise<RemoteDeleteResult> {
        let signedRequest;
        try {
            signedRequest = await signS3Request({
                config: this.s3Config,
                method: 'DELETE',
                key: object.key,
                now: this.now(),
            });
        } catch (error) {
            if (error instanceof S3RequestConfigurationError) {
                return deleteFailure(object.key, 'configuration');
            }
            return deleteFailure(object.key, 'unknown');
        }

        let response;
        try {
            response = await this.requestClient.request({
                url: signedRequest.url,
                method: 'DELETE',
                headers: signedRequest.headers,
                throw: false,
            });
        } catch (error) {
            if (error instanceof RemoteProviderError) {
                return deleteFailure(object.key, error.code, error.status, error.retryable);
            }
            return deleteFailure(object.key, 'network', undefined, true);
        }

        if (response.status === 204) {
            const deleteMarker = readHeader(response.headers, 'x-amz-delete-marker') === 'true';
            return {
                key: object.key,
                success: true,
                status: 204,
                deletionKind: deleteMarker ? 'delete-marker' : 'unknown',
            };
        }

        const failure = classifyS3DeleteFailure(response.status, response.text, this.parseXml);
        return deleteFailure(object.key, failure, response.status);
    }
}

function classifyS3DeleteFailure(
    status: number,
    xml: string,
    parseXml: S3XmlDocumentParser
): RemoteDeleteFailureCode {
    if (status === 409) return 'conflict';
    if (status === 412) return 'precondition';
    if (status === 423) return 'locked';
    const serviceCode = readS3ErrorCode(xml, parseXml);
    if (['ObjectLocked', 'ObjectUnderRetention', 'LegalHold'].includes(serviceCode ?? '')) return 'locked';
    if (serviceCode === 'Conflict' || serviceCode === 'OperationAborted') return 'conflict';
    if (serviceCode === 'PreconditionFailed') return 'precondition';
    if (['InvalidAccessKeyId', 'SignatureDoesNotMatch', 'ExpiredToken', 'InvalidToken'].includes(serviceCode ?? '')) {
        return 'authentication';
    }
    if (serviceCode === 'AccessDenied') return 'permission';
    if (serviceCode === 'NoSuchBucket' || serviceCode === 'NoSuchKey') return 'not-found';
    if (serviceCode === 'SlowDown') return 'rate-limit';
    return codeForHttpStatus(status);
}

function deleteFailure(
    key: string,
    failureCode: RemoteDeleteFailureCode,
    status?: number,
    retryable = failureCode === 'rate-limit' || failureCode === 'network' || failureCode === 'service'
): RemoteDeleteResult {
    return {
        key,
        success: false,
        ...(status !== undefined ? { status } : {}),
        failureCode,
        retryable,
    };
}

function readHeader(headers: Record<string, string>, name: string): string | undefined {
    const entry = Object.entries(headers).find(([key]) => key.toLowerCase() === name);
    return entry?.[1]?.trim().toLowerCase();
}

export function buildListQuery(request: RemoteListRequest): S3QueryParameter[] {
    const prefix = request.prefix.replace(/^\/+|\/+$/g, '');
    const limit = Number.isFinite(request.limit)
        ? Math.min(1000, Math.max(1, Math.floor(request.limit)))
        : 100;
    const query: S3QueryParameter[] = [
        ['list-type', '2'],
        ['encoding-type', 'url'],
        ['max-keys', String(limit)],
    ];
    if (prefix) query.push(['prefix', `${prefix}/`]);
    if (request.delimiter !== undefined) query.push(['delimiter', request.delimiter]);
    if (request.cursor !== undefined) query.push(['continuation-token', request.cursor]);
    return query;
}

export function parseS3ListObjectsV2(
    xml: string,
    hostingId: string,
    parseXml: S3XmlDocumentParser = parseXmlDocument
): RemoteListPage {
    const document = parseS3Document(xml, parseXml);
    const root = document.documentElement;
    if (!root || root.localName !== 'ListBucketResult') throw new RemoteProviderError('parsing');

    const encodingType = readDirectText(root, 'EncodingType');
    if (encodingType !== undefined && encodingType !== 'url') {
        throw new RemoteProviderError('parsing');
    }

    const truncatedValue = readDirectText(root, 'IsTruncated');
    if (truncatedValue !== 'true' && truncatedValue !== 'false') {
        throw new RemoteProviderError('parsing');
    }
    const isTruncated = truncatedValue === 'true';
    const nextCursor = readDirectText(root, 'NextContinuationToken');
    if (isTruncated && !nextCursor) throw new RemoteProviderError('parsing');

    const objects = directChildren(root, 'Contents').map((element) =>
        parseS3Object(element, hostingId, encodingType)
    );
    return {
        objects,
        isTruncated,
        ...(nextCursor ? { nextCursor } : {}),
    };
}

export function parseS3ListFolders(
    xml: string,
    parseXml: S3XmlDocumentParser = parseXmlDocument
): RemoteFolderListPage {
    const document = parseS3Document(xml, parseXml);
    const root = document.documentElement;
    if (!root || root.localName !== 'ListBucketResult') throw new RemoteProviderError('parsing');

    const encodingType = readDirectText(root, 'EncodingType');
    if (encodingType !== undefined && encodingType !== 'url') {
        throw new RemoteProviderError('parsing');
    }

    const truncatedValue = readDirectText(root, 'IsTruncated');
    if (truncatedValue !== 'true' && truncatedValue !== 'false') {
        throw new RemoteProviderError('parsing');
    }
    const isTruncated = truncatedValue === 'true';
    const nextCursor = readDirectText(root, 'NextContinuationToken');
    if (isTruncated && !nextCursor) throw new RemoteProviderError('parsing');

    const prefixes = directChildren(root, 'CommonPrefixes').map((element) => {
        const rawPrefix = readRequiredText(element, 'Prefix');
        const decoded = decodeS3ListValue(rawPrefix, encodingType);
        if (!decoded.endsWith('/')) throw new RemoteProviderError('parsing');
        const normalized = decoded.replace(/^\/+|\/+$/g, '');
        if (!normalized) throw new RemoteProviderError('parsing');
        return normalized;
    });
    return {
        prefixes: [...new Set(prefixes)],
        isTruncated,
        ...(nextCursor ? { nextCursor } : {}),
    };
}

export function buildS3ReferenceMapping(config: ImageHostingConfig): RemoteUrlMapping {
    const settings = getRemoteManagementConfig(config);
    const s3Config = config.config as S3Config;
    const derivedBases: string[] = [];
    for (const forcePathStyle of [true, false]) {
        try {
            const target = buildS3RequestTarget({ ...s3Config, forcePathStyle }, '');
            derivedBases.push(target.url.replace(/\/+$/, ''));
        } catch {
            // Invalid endpoints remain a configuration error when listing is requested.
        }
    }

    return {
        hostingId: config.id,
        urlPrefix: normalizePublicUrlBase(config.urlPrefix),
        publicUrlAliases: [...new Set([
            ...settings.publicUrlAliases.map(normalizePublicUrlBase),
            ...derivedBases,
        ].filter(Boolean))],
    };
}

function parseS3Object(element: Element, hostingId: string, encodingType: string | undefined): RemoteObject {
    const rawKey = readRequiredText(element, 'Key');
    const key = decodeS3ListValue(rawKey, encodingType);

    const sizeText = readRequiredText(element, 'Size');
    if (!/^\d+$/.test(sizeText)) throw new RemoteProviderError('parsing');
    const size = Number(sizeText);
    if (!Number.isSafeInteger(size) || size < 0) throw new RemoteProviderError('parsing');

    const lastModifiedText = readDirectText(element, 'LastModified');
    let lastModified: number | undefined;
    if (lastModifiedText) {
        lastModified = Date.parse(lastModifiedText);
        if (!Number.isFinite(lastModified)) throw new RemoteProviderError('parsing');
    }

    const etag = readDirectText(element, 'ETag');
    const storageClass = readDirectText(element, 'StorageClass');
    return {
        hostingId,
        key,
        size,
        ...(lastModified !== undefined ? { lastModified } : {}),
        ...(etag !== undefined ? { etag } : {}),
        ...(storageClass !== undefined ? { storageClass } : {}),
    };
}

function decodeS3ListValue(value: string, encodingType: string | undefined): string {
    if (encodingType !== 'url') return value;
    try {
        return decodeURIComponent(value);
    } catch {
        throw new RemoteProviderError('parsing');
    }
}

function isDirectChildPrefix(prefix: string, parent: string): boolean {
    const normalizedParent = parent.trim().replace(/^\/+|\/+$/g, '');
    const base = normalizedParent ? `${normalizedParent}/` : '';
    if (!prefix.startsWith(base)) return false;
    const relative = prefix.slice(base.length);
    return Boolean(relative) && !relative.includes('/');
}

function mapS3ResponseError(
    status: number,
    xml: string,
    url: string,
    parseXml: S3XmlDocumentParser
): RemoteProviderError {
    const serviceCode = readS3ErrorCode(xml, parseXml);
    let code = codeForHttpStatus(status);
    if (['InvalidAccessKeyId', 'SignatureDoesNotMatch', 'ExpiredToken', 'InvalidToken'].includes(serviceCode ?? '')) {
        code = 'authentication';
    } else if (serviceCode === 'AccessDenied') {
        code = 'permission';
    } else if (serviceCode === 'NoSuchBucket') {
        code = 'not-found';
    } else if (serviceCode === 'SlowDown') {
        code = 'rate-limit';
    }
    return new RemoteProviderError(code, {
        status,
        endpoint: sanitizeRemoteEndpoint(url),
    });
}

function readS3ErrorCode(xml: string, parseXml: S3XmlDocumentParser): string | undefined {
    try {
        const document = parseS3Document(xml, parseXml);
        if (document.documentElement?.localName !== 'Error') return undefined;
        return readDirectText(document.documentElement, 'Code');
    } catch {
        return undefined;
    }
}

function parseS3Document(xml: string, parseXml: S3XmlDocumentParser): Document {
    try {
        const document = parseXml(xml);
        const parseErrors = document.getElementsByTagName('parsererror');
        if (!document.documentElement || parseErrors.length > 0) {
            throw new RemoteProviderError('parsing');
        }
        return document;
    } catch (error) {
        if (error instanceof RemoteProviderError) throw error;
        throw new RemoteProviderError('parsing');
    }
}

function parseXmlDocument(xml: string): Document {
    return new DOMParser().parseFromString(xml, 'application/xml');
}

function readRequiredText(parent: Element, name: string): string {
    const value = readDirectText(parent, name);
    if (!value) throw new RemoteProviderError('parsing');
    return value;
}

function readDirectText(parent: Element, name: string): string | undefined {
    return directChildren(parent, name)[0]?.textContent?.trim() ?? undefined;
}

function directChildren(parent: Element, name: string): Element[] {
    const result: Element[] = [];
    for (let index = 0; index < parent.childNodes.length; index++) {
        const node = parent.childNodes.item(index);
        if (node?.nodeType === 1 && (node as Element).localName === name) {
            result.push(node as Element);
        }
    }
    return result;
}
