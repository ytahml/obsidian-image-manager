import type { AliyunOSSConfig, ImageHostingConfig } from '../../types';
import { presignOssGetRequest, signOssRequest, OssRequestConfigurationError, type OssQueryParameter } from '../../oss/sigv4';
import { encodePublicPath, joinPublicUrl, normalizePublicUrlBase } from '../../uploaders/public-url';
import { RemoteProviderError, codeForHttpStatus, sanitizeRemoteEndpoint } from '../errors';
import { getRemoteManagementConfig } from '../management-settings';
import type { RemoteObjectProvider } from '../provider';
import { RemoteRequestClient } from '../request';
import {
    buildListQuery,
    parseS3ListFolders,
    parseS3ListObjectsV2,
    type S3XmlDocumentParser,
} from './s3-compatible-remote';
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

const OSS_CAPABILITIES = new Set<'list' | 'folders' | 'preview' | 'delete'>([
    'list', 'folders', 'preview', 'delete',
]);

/** Native Aliyun OSS adapter; shared browser and delete safeguards remain provider-independent. */
export class AliyunOSSRemoteObjectProvider implements RemoteObjectProvider {
    readonly capabilities = OSS_CAPABILITIES;
    readonly referenceMapping: RemoteUrlMapping;
    private readonly ossConfig: AliyunOSSConfig;

    constructor(
        private readonly hostingConfig: ImageHostingConfig,
        private readonly requestClient = new RemoteRequestClient(),
        private readonly parseXml: S3XmlDocumentParser = parseXmlDocument,
        private readonly now: () => Date = () => new Date()
    ) {
        this.ossConfig = hostingConfig.config as AliyunOSSConfig;
        this.referenceMapping = buildOssReferenceMapping(hostingConfig);
    }

    async listObjects(request: RemoteListRequest): Promise<RemoteListPage> {
        const xml = await this.requestList(buildOssListQuery(request));
        return parseS3ListObjectsV2(xml, this.hostingConfig.id, this.parseXml);
    }

    async listFolders(request: RemoteFolderListRequest): Promise<RemoteFolderListPage> {
        const xml = await this.requestList(buildOssListQuery({ ...request, delimiter: '/' }));
        const page = parseS3ListFolders(xml, this.parseXml);
        if (page.prefixes.some((prefix) => !isDirectChildPrefix(prefix, request.prefix))) {
            throw new RemoteProviderError('parsing');
        }
        return page;
    }

    async createPreviewUrl(object: RemoteObject): Promise<RemotePreviewUrl> {
        const settings = getRemoteManagementConfig(this.hostingConfig);
        if (settings.previewAccess === 'public') {
            const base = normalizePublicUrlBase(this.hostingConfig.urlPrefix);
            if (!base) throw new RemoteProviderError('configuration');
            return { url: joinPublicUrl(base, encodePublicPath(object.key)), access: 'public' };
        }
        try {
            const preview = await presignOssGetRequest({
                config: this.ossConfig,
                key: object.key,
                expiresInSeconds: 300,
                now: this.now(),
            });
            return { url: preview.url, access: 'presigned', expiresAt: preview.expiresAt };
        } catch (error) {
            if (error instanceof OssRequestConfigurationError) throw new RemoteProviderError('configuration');
            throw error;
        }
    }

    async deleteObject(object: RemoteObject): Promise<RemoteDeleteResult> {
        let signedRequest;
        try {
            signedRequest = await signOssRequest({
                config: this.ossConfig,
                method: 'DELETE',
                key: object.key,
                now: this.now(),
            });
        } catch (error) {
            return deleteFailure(object.key, error instanceof OssRequestConfigurationError ? 'configuration' : 'unknown');
        }
        try {
            const response = await this.requestClient.request({
                url: signedRequest.url,
                method: 'DELETE',
                headers: signedRequest.headers,
                throw: false,
            });
            if (response.status === 204) {
                return {
                    key: object.key,
                    success: true,
                    status: 204,
                    deletionKind: readHeader(response.headers, 'x-oss-delete-marker') === 'true'
                        ? 'delete-marker'
                        : 'unknown',
                };
            }
            return deleteFailure(object.key, classifyOssDeleteFailure(response.status, response.text, this.parseXml), response.status);
        } catch (error) {
            if (error instanceof RemoteProviderError) {
                return deleteFailure(object.key, error.code, error.status, error.retryable);
            }
            return deleteFailure(object.key, 'network', undefined, true);
        }
    }

    private async requestList(query: readonly OssQueryParameter[]): Promise<string> {
        let signedRequest;
        try {
            signedRequest = await signOssRequest({
                config: this.ossConfig,
                method: 'GET',
                query,
                now: this.now(),
            });
        } catch (error) {
            if (error instanceof OssRequestConfigurationError) throw new RemoteProviderError('configuration');
            throw error;
        }
        const response = await this.requestClient.request({
            url: signedRequest.url,
            method: 'GET',
            headers: signedRequest.headers,
            throw: false,
        });
        if (response.status >= 400) {
            throw mapOssResponseError(response.status, response.text, signedRequest.url, this.parseXml);
        }
        return response.text;
    }
}

export function buildOssListQuery(request: RemoteListRequest): OssQueryParameter[] {
    return buildListQuery(request);
}

export function buildOssReferenceMapping(config: ImageHostingConfig): RemoteUrlMapping {
    const settings = getRemoteManagementConfig(config);
    const ossConfig = config.config as AliyunOSSConfig;
    const derivedBase = getOssOriginBase(ossConfig);
    return {
        hostingId: config.id,
        urlPrefix: normalizePublicUrlBase(config.urlPrefix),
        publicUrlAliases: [...new Set([
            ...settings.publicUrlAliases.map(normalizePublicUrlBase),
            derivedBase,
        ].filter(Boolean))],
    };
}

function getOssOriginBase(config: AliyunOSSConfig): string {
    try {
        const region = config.region.trim().replace(/^oss-/, '').replace(/\.aliyuncs\.com.*$/, '');
        if (!region || !config.bucket.trim()) return '';
        return `https://${config.bucket.trim()}.oss-${region}.aliyuncs.com`;
    } catch {
        return '';
    }
}

function mapOssResponseError(
    status: number,
    xml: string,
    url: string,
    parseXml: S3XmlDocumentParser
): RemoteProviderError {
    const serviceCode = readOssErrorCode(xml, parseXml);
    let code = codeForHttpStatus(status);
    if (['InvalidAccessKeyId', 'SignatureDoesNotMatch', 'RequestTimeTooSkewed', 'InvalidSecurityToken'].includes(serviceCode ?? '')) {
        code = 'authentication';
    } else if (serviceCode === 'AccessDenied') {
        code = 'permission';
    } else if (serviceCode === 'NoSuchBucket') {
        code = 'not-found';
    } else if (['SlowDown', 'TooManyRequests'].includes(serviceCode ?? '')) {
        code = 'rate-limit';
    }
    return new RemoteProviderError(code, { status, endpoint: sanitizeRemoteEndpoint(url) });
}

function classifyOssDeleteFailure(status: number, xml: string, parseXml: S3XmlDocumentParser): RemoteDeleteFailureCode {
    if (status === 409) return 'conflict';
    if (status === 412) return 'precondition';
    if (status === 423) return 'locked';
    const serviceCode = readOssErrorCode(xml, parseXml);
    if (['ObjectLocked', 'ObjectUnderRetention', 'LegalHold'].includes(serviceCode ?? '')) return 'locked';
    if (['Conflict', 'OperationAborted'].includes(serviceCode ?? '')) return 'conflict';
    if (serviceCode === 'PreconditionFailed') return 'precondition';
    if (['InvalidAccessKeyId', 'SignatureDoesNotMatch', 'RequestTimeTooSkewed', 'InvalidSecurityToken'].includes(serviceCode ?? '')) return 'authentication';
    if (serviceCode === 'AccessDenied') return 'permission';
    if (serviceCode === 'NoSuchBucket') return 'not-found';
    if (['SlowDown', 'TooManyRequests'].includes(serviceCode ?? '')) return 'rate-limit';
    return codeForHttpStatus(status);
}

function readOssErrorCode(xml: string, parseXml: S3XmlDocumentParser): string | undefined {
    try {
        const document = parseXml(xml);
        const root = document.documentElement;
        if (!root || root.localName !== 'Error') return undefined;
        for (let index = 0; index < root.childNodes.length; index++) {
            const node = root.childNodes.item(index);
            if (node?.nodeType === 1 && (node as Element).localName === 'Code') return node.textContent?.trim();
        }
    } catch {
        // Keep the HTTP classification when the service error body is malformed.
    }
    return undefined;
}

function readHeader(headers: Record<string, string>, name: string): string | undefined {
    const entry = Object.entries(headers).find(([key]) => key.toLowerCase() === name);
    return entry?.[1]?.trim().toLowerCase();
}

function isDirectChildPrefix(prefix: string, parent: string): boolean {
    const normalizedParent = parent.trim().replace(/^\/+|\/+$/g, '');
    const base = normalizedParent ? `${normalizedParent}/` : '';
    if (!prefix.startsWith(base)) return false;
    const relative = prefix.slice(base.length);
    return Boolean(relative) && !relative.includes('/');
}

function deleteFailure(
    key: string,
    failureCode: RemoteDeleteFailureCode,
    status?: number,
    retryable = failureCode === 'rate-limit' || failureCode === 'network' || failureCode === 'service'
): RemoteDeleteResult {
    return { key, success: false, ...(status !== undefined ? { status } : {}), failureCode, retryable };
}

function parseXmlDocument(xml: string): Document {
    return new DOMParser().parseFromString(xml, 'application/xml');
}
