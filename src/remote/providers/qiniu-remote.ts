import type { ImageHostingConfig, QiniuConfig } from '../../types';
import {
    createQiniuManagementHeaders,
    createQiniuPrivateDownloadUrl,
    encodeQiniuEntryUri,
} from '../../qiniu/auth';
import { encodePublicPath, joinPublicUrl, normalizePublicUrlBase } from '../../uploaders/public-url';
import { RemoteProviderError, codeForHttpStatus, sanitizeRemoteEndpoint } from '../errors';
import { getRemoteManagementConfig } from '../management-settings';
import type { RemoteObjectProvider } from '../provider';
import { RemoteRequestClient } from '../request';
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

const QINIU_LIST_ENDPOINT = 'https://rsf.qiniuapi.com/list';
const QINIU_DELETE_ENDPOINT = 'https://rs.qiniuapi.com';
const QINIU_CAPABILITIES = new Set<'list' | 'folders' | 'preview' | 'delete'>([
    'list', 'folders', 'preview', 'delete',
]);

interface QiniuListItem {
    key?: unknown;
    hash?: unknown;
    fsize?: unknown;
    mimeType?: unknown;
    putTime?: unknown;
    lastModify?: unknown;
    type?: unknown;
    status?: unknown;
}

interface QiniuListResponse {
    marker?: unknown;
    items?: unknown;
    commonPrefixes?: unknown;
}

/** Native Qiniu Kodo adapter; all provider-specific HTTP details stop here. */
export class QiniuRemoteObjectProvider implements RemoteObjectProvider {
    readonly capabilities = QINIU_CAPABILITIES;
    readonly referenceMapping: RemoteUrlMapping;
    private readonly qiniuConfig: QiniuConfig;

    constructor(
        private readonly hostingConfig: ImageHostingConfig,
        private readonly requestClient = new RemoteRequestClient(),
        private readonly now: () => Date = () => new Date()
    ) {
        this.qiniuConfig = hostingConfig.config as QiniuConfig;
        this.referenceMapping = buildQiniuReferenceMapping(hostingConfig);
    }

    async listObjects(request: RemoteListRequest): Promise<RemoteListPage> {
        const page = await this.requestList(request);
        return parseQiniuListObjects(page, this.hostingConfig.id);
    }

    async listFolders(request: RemoteFolderListRequest): Promise<RemoteFolderListPage> {
        const page = await this.requestList({ ...request, delimiter: '/' });
        const folders = parseQiniuListFolders(page);
        if (folders.prefixes.some((prefix) => !isDirectChildPrefix(prefix, request.prefix))) {
            throw new RemoteProviderError('parsing');
        }
        return folders;
    }

    async createPreviewUrl(object: RemoteObject): Promise<RemotePreviewUrl> {
        const base = normalizePublicUrlBase(this.hostingConfig.urlPrefix);
        if (!base) throw new RemoteProviderError('configuration');
        const publicUrl = joinPublicUrl(base, encodePublicPath(object.key));
        if (getRemoteManagementConfig(this.hostingConfig).previewAccess === 'public') {
            return { url: publicUrl, access: 'public' };
        }
        const expiresAt = Math.floor(this.now().getTime() / 1000) + 300;
        return {
            url: await createQiniuPrivateDownloadUrl(this.qiniuConfig, publicUrl, expiresAt),
            access: 'presigned',
            expiresAt: expiresAt * 1000,
        };
    }

    async deleteObject(object: RemoteObject): Promise<RemoteDeleteResult> {
        if (!isValidConfig(this.qiniuConfig)) return deleteFailure(object.key, 'configuration');
        const entry = encodeQiniuEntryUri(this.qiniuConfig.bucket, object.key);
        const url = new URL(`/delete/${entry}`, QINIU_DELETE_ENDPOINT);
        try {
            const headers = await createQiniuManagementHeaders(this.qiniuConfig, 'POST', url, this.now());
            const response = await this.requestClient.request({
                url: url.toString(), method: 'POST', headers, throw: false,
            });
            if (response.status === 200) {
                return { key: object.key, success: true, status: 200, deletionKind: 'permanent' };
            }
            return deleteFailure(object.key, classifyDeleteFailure(response.status), response.status);
        } catch (error) {
            if (error instanceof RemoteProviderError) {
                return deleteFailure(object.key, error.code, error.status, error.retryable);
            }
            return deleteFailure(object.key, 'network', undefined, true);
        }
    }

    private async requestList(request: RemoteListRequest): Promise<QiniuListResponse> {
        if (!isValidConfig(this.qiniuConfig)) throw new RemoteProviderError('configuration');
        const url = new URL(QINIU_LIST_ENDPOINT);
        const prefix = normalizeScopePrefix(request.prefix);
        url.searchParams.set('bucket', this.qiniuConfig.bucket.trim());
        url.searchParams.set('limit', String(normalizeLimit(request.limit)));
        if (prefix) url.searchParams.set('prefix', prefix);
        if (request.cursor) url.searchParams.set('marker', request.cursor);
        if (request.delimiter) url.searchParams.set('delimiter', request.delimiter);
        const headers = await createQiniuManagementHeaders(this.qiniuConfig, 'GET', url, this.now());
        const response = await this.requestClient.request({
            url: url.toString(), method: 'GET', headers, throw: false,
        });
        if (response.status >= 400) {
            throw new RemoteProviderError(codeForQiniuStatus(response.status), {
                status: response.status,
                endpoint: sanitizeRemoteEndpoint(url.toString()),
            });
        }
        return parseResponse(response.text);
    }
}

export function buildQiniuReferenceMapping(config: ImageHostingConfig): RemoteUrlMapping {
    const settings = getRemoteManagementConfig(config);
    return {
        hostingId: config.id,
        urlPrefix: config.urlPrefix,
        publicUrlAliases: settings.publicUrlAliases,
    };
}

export function parseQiniuListObjects(value: QiniuListResponse, hostingId: string): RemoteListPage {
    const items = parseItems(value.items, hostingId);
    const marker = parseMarker(value.marker);
    return { objects: items, ...(marker ? { nextCursor: marker } : {}), isTruncated: Boolean(marker) };
}

export function parseQiniuListFolders(value: QiniuListResponse): RemoteFolderListPage {
    if (value.commonPrefixes === undefined) return { prefixes: [], isTruncated: Boolean(parseMarker(value.marker)) };
    if (!isStringArray(value.commonPrefixes)) {
        throw new RemoteProviderError('parsing');
    }
    const prefixes = value.commonPrefixes.map((prefix) => normalizeFolderPrefix(prefix));
    const marker = parseMarker(value.marker);
    return { prefixes, ...(marker ? { nextCursor: marker } : {}), isTruncated: Boolean(marker) };
}

function parseResponse(text: string): QiniuListResponse {
    try {
        const value = JSON.parse(text) as unknown;
        if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid');
        return value;
    } catch {
        throw new RemoteProviderError('parsing');
    }
}

function parseItems(value: unknown, hostingId: string): RemoteObject[] {
    if (value === undefined) return [];
    if (!Array.isArray(value)) throw new RemoteProviderError('parsing');
    return value.map((item) => parseItem(item, hostingId));
}

function isStringArray(value: unknown): value is string[] {
    return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function parseItem(value: unknown, hostingId: string): RemoteObject {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new RemoteProviderError('parsing');
    const item = value as QiniuListItem;
    if (typeof item.key !== 'string' || !item.key || typeof item.fsize !== 'number' ||
        !Number.isSafeInteger(item.fsize) || item.fsize < 0) throw new RemoteProviderError('parsing');
    const lastModified = parseQiniuTime(item.lastModify ?? item.putTime);
    const storageClass = mapStorageClass(item.type);
    const availability = mapAvailability(item.status);
    return {
        hostingId,
        key: item.key,
        size: item.fsize,
        ...(lastModified !== undefined ? { lastModified } : {}),
        ...(typeof item.hash === 'string' ? { etag: item.hash } : {}),
        ...(typeof item.mimeType === 'string' ? { mimeType: item.mimeType } : {}),
        ...(storageClass ? { storageClass } : {}),
        ...(availability ? { availability } : {}),
    };
}

function parseQiniuTime(value: unknown): number | undefined {
    if (value === undefined) return undefined;
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) throw new RemoteProviderError('parsing');
    const milliseconds = Math.floor(value / 10_000);
    if (!Number.isFinite(milliseconds)) throw new RemoteProviderError('parsing');
    return milliseconds;
}

function mapStorageClass(value: unknown): string | undefined {
    if (value === undefined) return undefined;
    const classes: Record<number, string> = {
        0: 'STANDARD', 1: 'INFREQUENT_ACCESS', 2: 'ARCHIVE', 3: 'DEEP_ARCHIVE',
        4: 'ARCHIVE_DIRECT_READ', 5: 'INTELLIGENT_TIERING',
    };
    if (typeof value !== 'number' || !Number.isInteger(value) || !classes[value]) {
        throw new RemoteProviderError('parsing');
    }
    return classes[value];
}

function mapAvailability(value: unknown): 'enabled' | 'disabled' | undefined {
    if (value === undefined) return undefined;
    if (value === 0) return 'enabled';
    if (value === 1) return 'disabled';
    throw new RemoteProviderError('parsing');
}

function parseMarker(value: unknown): string | undefined {
    if (value === undefined || value === '') return undefined;
    if (typeof value !== 'string') throw new RemoteProviderError('parsing');
    return value;
}

function normalizeScopePrefix(value: string): string {
    const prefix = value.trim().replace(/^\/+|\/+$/g, '');
    return prefix ? `${prefix}/` : '';
}

function normalizeFolderPrefix(value: string): string {
    const prefix = value.trim().replace(/^\/+|\/+$/g, '');
    if (!prefix) throw new RemoteProviderError('parsing');
    return prefix;
}

function isDirectChildPrefix(prefix: string, parent: string): boolean {
    const normalizedParent = parent.trim().replace(/^\/+|\/+$/g, '');
    const base = normalizedParent ? `${normalizedParent}/` : '';
    if (!prefix.startsWith(base)) return false;
    const relative = prefix.slice(base.length);
    return Boolean(relative) && !relative.includes('/');
}

function normalizeLimit(value: number): number {
    return Number.isFinite(value) ? Math.min(1000, Math.max(1, Math.floor(value))) : 100;
}

function isValidConfig(config: QiniuConfig): boolean {
    return Boolean(config.accessKey.trim() && config.secretKey.trim() && config.bucket.trim());
}

function codeForQiniuStatus(status: number): ReturnType<typeof codeForHttpStatus> {
    if (status === 599) return 'service';
    return codeForHttpStatus(status);
}

function classifyDeleteFailure(status: number): RemoteDeleteFailureCode {
    if (status === 612) return 'not-found';
    return codeForQiniuStatus(status);
}

function deleteFailure(
    key: string,
    failureCode: RemoteDeleteFailureCode,
    status?: number,
    retryable = failureCode === 'rate-limit' || failureCode === 'network' || failureCode === 'service'
): RemoteDeleteResult {
    return { key, success: false, ...(status !== undefined ? { status } : {}), failureCode, retryable };
}
