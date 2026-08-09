import { TFile } from 'obsidian';
import type { RemoteDeleteAuditEntry } from './remote/types';

/** 图片文件信息 */
export interface ImageFile {
    file: TFile;
    name: string;
    path: string;
    extension: string;
    size: number;
    created: number;
    modified: number;
    referencedBy: string[]; // 引用此图片的笔记路径
}

/** 图片引用格式 */
export type ReferenceFormat = 'markdown' | 'wiki';

/** 图片引用信息 */
export interface ImageReference {
    fullMatch: string;
    altText: string;
    path: string;
    format: ReferenceFormat;
    line: number;
    col: number;
}

/** 图床类型 */
export type HostingType = 'aliyun-oss' | 'qiniu' | 's3' | 'custom';

/** 图床配置 */
export interface ImageHostingConfig {
    id: string;
    name: string;
    type: HostingType;
    enabled: boolean;
    config: AliyunOSSConfig | QiniuConfig | S3Config | CustomConfig;
    uploadPath: string;
    /** Public access URL base, optionally including a bucket or directory path. */
    urlPrefix: string;
    /** Optional remote-object browser settings. Missing values keep old configs disabled. */
    remoteManagement?: RemoteManagementConfig;
}

/** Per-hosting safety settings for remote object management. */
export interface RemoteManagementConfig {
    enabled: boolean;
    prefix: string;
    /** Legacy persisted value; the card grid no longer paginates locally. */
    pageSize: number;
    /** Normalized to viewport; retained only for old data.json compatibility. */
    previewMode: 'manual' | 'viewport';
    previewAccess: 'presigned' | 'public';
    publicUrlAliases: string[];
}

/** 上传调用上下文 */
export interface UploadContext {
    /** 图片文件相对于 Vault 根目录的路径 */
    sourcePath?: string;
}

/** 阿里云 OSS 配置 */
export interface AliyunOSSConfig {
    region: string;
    accessKeyId: string;
    accessKeySecret: string;
    bucket: string;
}

/** 七牛云配置 */
export interface QiniuConfig {
    accessKey: string;
    secretKey: string;
    bucket: string;
    region: string;
}

/** S3 兼容存储配置 */
export interface S3Config {
    endpoint: string;
    region: string;
    accessKeyId: string;
    secretAccessKey: string;
    bucket: string;
    forcePathStyle?: boolean;
}

/** 自定义图床配置 */
export interface CustomConfig {
    uploadUrl: string;
    method: 'POST' | 'PUT';
    headers: Record<string, string>;
    fileFieldName: string;
    jsonPath: string;
    extraBody: Record<string, string>;
}

/** 上传结果 */
export interface UploadResult {
    success: boolean;
    url?: string;
    /** Logical remote object key for native providers; Custom intentionally omits it. */
    objectKey?: string;
    error?: string;
    originalPath: string;
}

/** 迁移记录 */
export interface MigrationRecord {
    timestamp: number;
    sourceHosting: string;
    targetHosting: string;
    imageCount: number;
    affectedNotes: string[];
    changes: MigrationChange[];
}

/** 迁移变更 */
export interface MigrationChange {
    notePath: string;
    oldRef: string;
    newRef: string;
}

/** 排序方式 */
export type SortBy = 'name' | 'size' | 'modified' | 'created' | 'reference-count';
export type SortOrder = 'asc' | 'desc';

/** 图片筛选条件 */
export interface ImageFilter {
    keyword?: string;
    extensions?: string[];
    minSize?: number;
    maxSize?: number;
    directory?: string;
    onlyOrphans?: boolean;
}

/** 插件设置 */
export interface ImageManagerSettings {
    locale: 'en' | 'zh';
    imagePathTemplate: string;
    imagePathBase: 'vault' | 'note';
    supportedExtensions: string[];
    /** Legacy persisted value, read only during migration. */
    autoCompress?: boolean;
    localManagementMode: 'managed' | 'delegated';
    managedPasteReferenceFormat: ReferenceFormat;
    compressManagedPasteLocal: boolean;
    compressBeforeUpload: boolean;
    compressQuality: number;
    thumbnailSize: number;
    imageNamingTemplate: string;
    promptImageName: boolean;
    hostingConfigs: ImageHostingConfig[];
    defaultHostingId: string;
    uploadPathTemplate: string;
    autoReplaceAfterUpload: boolean;
    customReferenceTemplate: string;
    reorganizeConvertFormat: boolean;
    skipWikiRefsOnReorganize: boolean;
    enableImageBrowser: boolean;
    managedAutoUploadOnPaste: boolean;
    delegatedAutoUploadOnPaste: boolean;
    managedKeepLocalCopy: boolean;
    delegatedKeepLocalCopy: boolean;
    /** Legacy persisted value, read only during migration. */
    autoUploadOnPaste?: boolean;
    /** Legacy persisted value, read only during migration. */
    keepLocalCopy?: boolean;
    remoteDeleteHistory: RemoteDeleteAuditEntry[];
}

export const DEFAULT_UPLOAD_PATH_TEMPLATE = 'images/{year}/{month}/{hash}.{ext}';

export const DEFAULT_SETTINGS: ImageManagerSettings = {
    locale: 'en',
    imagePathTemplate: 'attachments',
    imagePathBase: 'note',
    supportedExtensions: ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'svg', 'webp', 'ico', 'tiff', 'avif'],
    localManagementMode: 'managed',
    managedPasteReferenceFormat: 'markdown',
    compressManagedPasteLocal: false,
    compressBeforeUpload: false,
    compressQuality: 80,
    thumbnailSize: 200,
    imageNamingTemplate: 'image-{timestamp}',
    promptImageName: false,
    hostingConfigs: [],
    defaultHostingId: '',
    uploadPathTemplate: DEFAULT_UPLOAD_PATH_TEMPLATE,
    autoReplaceAfterUpload: false,
    customReferenceTemplate: '',
    reorganizeConvertFormat: true,
    skipWikiRefsOnReorganize: true,
    enableImageBrowser: true,
    managedAutoUploadOnPaste: false,
    delegatedAutoUploadOnPaste: false,
    managedKeepLocalCopy: false,
    delegatedKeepLocalCopy: false,
    remoteDeleteHistory: [],
};

export function normalizeImageManagerSettings(loaded: Partial<ImageManagerSettings> | null): ImageManagerSettings {
    const merged = Object.assign({}, DEFAULT_SETTINGS, loaded ?? {});
    const legacyCompression = typeof loaded?.autoCompress === 'boolean' ? loaded.autoCompress : undefined;
    const legacyMarkdown = loaded?.reorganizeConvertFormat ?? DEFAULT_SETTINGS.reorganizeConvertFormat;
    const canResolveEnabledHosting = merged.hostingConfigs.some((config) => config.enabled);

    merged.localManagementMode = loaded?.localManagementMode === 'delegated' ? 'delegated' : 'managed';
    merged.managedPasteReferenceFormat = loaded?.managedPasteReferenceFormat === 'wiki'
        ? 'wiki'
        : legacyMarkdown ? 'markdown' : 'wiki';
    merged.compressManagedPasteLocal = typeof loaded?.compressManagedPasteLocal === 'boolean'
        ? loaded.compressManagedPasteLocal
        : legacyCompression ?? DEFAULT_SETTINGS.compressManagedPasteLocal;
    merged.compressBeforeUpload = typeof loaded?.compressBeforeUpload === 'boolean'
        ? loaded.compressBeforeUpload
        : legacyCompression ?? DEFAULT_SETTINGS.compressBeforeUpload;
    const legacyAutoUploadOnPaste = loaded?.localManagementMode === 'managed' || loaded?.localManagementMode === 'delegated'
        ? Boolean(loaded.autoUploadOnPaste)
        : Boolean(loaded?.autoUploadOnPaste && legacyMarkdown && canResolveEnabledHosting);
    const legacyKeepLocalCopy = Boolean(loaded?.keepLocalCopy);
    merged.managedAutoUploadOnPaste = typeof loaded?.managedAutoUploadOnPaste === 'boolean'
        ? loaded.managedAutoUploadOnPaste
        : legacyAutoUploadOnPaste;
    merged.delegatedAutoUploadOnPaste = typeof loaded?.delegatedAutoUploadOnPaste === 'boolean'
        ? loaded.delegatedAutoUploadOnPaste
        : legacyAutoUploadOnPaste;
    merged.managedKeepLocalCopy = typeof loaded?.managedKeepLocalCopy === 'boolean'
        ? loaded.managedKeepLocalCopy
        : legacyKeepLocalCopy;
    merged.delegatedKeepLocalCopy = typeof loaded?.delegatedKeepLocalCopy === 'boolean'
        ? loaded.delegatedKeepLocalCopy
        : legacyKeepLocalCopy;
    delete merged.autoUploadOnPaste;
    delete merged.keepLocalCopy;
    return merged;
}
