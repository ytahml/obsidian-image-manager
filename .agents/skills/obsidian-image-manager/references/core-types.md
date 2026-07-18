# 核心类型定义

## 文件：`src/types.ts`

### 领域类型

```typescript
// 图片文件信息（浏览器使用）
interface ImageFile {
    file: TFile;
    name: string;
    path: string;
    extension: string;
    size: number;
    created: number;
    modified: number;
    referencedBy: string[]; // 引用此图片的笔记路径
}

// 引用格式
type ReferenceFormat = 'markdown' | 'wiki';

// 图片引用（解析结果）
interface ImageReference {
    fullMatch: string;   // 完整匹配文本，如 ![alt](path)
    altText: string;     // alt 文本
    path: string;        // 引用路径
    format: ReferenceFormat;
    line: number;        // 行号（0-based）
    col: number;         // 字符索引（用于反向替换）
}

// 图床类型
type HostingType = 'aliyun-oss' | 'qiniu' | 's3' | 'custom';

// 图床配置
interface ImageHostingConfig {
    id: string;          // 唯一 ID，如 hosting-{timestamp}
    name: string;        // 用户定义名称
    type: HostingType;
    enabled: boolean;
    config: AliyunOSSConfig | QiniuConfig | S3Config | CustomConfig;
    uploadPath: string;  // 上传路径模板
    urlPrefix: string;   // 公共访问 URL 基础路径，可包含 bucket 或目录
    remoteManagement?: RemoteManagementConfig;
}

interface RemoteManagementConfig {
    enabled: boolean;                 // 旧配置默认 false
    prefix: string;                   // 空值表示当前 Bucket 根
    pageSize: number;                 // 默认 100，通用范围 1–1000
    previewMode: 'manual' | 'viewport'; // G3 固定为 manual
    deleteEnabled: boolean;           // G3 固定为 false
    publicUrlAliases: string[];       // CDN 或自定义域名映射
}

interface UploadContext {
    sourcePath?: string; // 图片相对于 Vault 根目录的路径
}
```

### 图床配置类型

```typescript
interface AliyunOSSConfig {
    region: string;
    accessKeyId: string;
    accessKeySecret: string;
    bucket: string;
}

interface QiniuConfig {
    accessKey: string;
    secretKey: string;
    bucket: string;
    region: string;      // z0/z1/z2/na0/as0
}

interface S3Config {
    endpoint: string;
    region: string;
    accessKeyId: string;
    secretAccessKey: string;
    bucket: string;
    forcePathStyle?: boolean;
}

interface CustomConfig {
    uploadUrl: string;
    method: 'POST' | 'PUT';
    headers: Record<string, string>;
    fileFieldName: string;
    jsonPath: string;    // 从响应中提取 URL 的 JSON 路径
    extraBody: Record<string, string>;
}
```

### 上传结果

```typescript
interface UploadResult {
    success: boolean;
    url?: string;
    error?: string;
    originalPath: string;
}
```

### 迁移类型（未实现）

```typescript
interface MigrationRecord {
    timestamp: number;
    sourceHosting: string;
    targetHosting: string;
    imageCount: number;
    affectedNotes: string[];
    changes: MigrationChange[];
}

interface MigrationChange {
    notePath: string;
    oldRef: string;
    newRef: string;
}
```

### 浏览器相关

```typescript
type SortBy = 'name' | 'size' | 'modified' | 'created' | 'reference-count';
type SortOrder = 'asc' | 'desc';

interface ImageFilter {
    keyword?: string;
    extensions?: string[];
    minSize?: number;
    maxSize?: number;
    directory?: string;
    onlyOrphans?: boolean;
}
```

## 设置接口

```typescript
interface ImageManagerSettings {
    locale: 'en' | 'zh';
    imagePathTemplate: string;        // 默认 'attachments'
    imagePathBase: 'vault' | 'note';  // 默认 'note'
    supportedExtensions: string[];    // 10 种格式
    autoCompress: boolean;            // 默认 false
    compressQuality: number;          // 1-100，默认 80
    thumbnailSize: number;            // 80-400，默认 200
    imageNamingTemplate: string;      // 默认 'image-{timestamp}'
    promptImageName: boolean;         // 默认 false
    hostingConfigs: ImageHostingConfig[];
    defaultHostingId: string;
    uploadPathTemplate: string;       // 默认 'images/{year}/{month}/{hash}.{ext}'
    autoReplaceAfterUpload: boolean;  // 默认 false
    reorganizeConvertFormat: boolean; // 默认 true（关键门控设置）
    skipWikiRefsOnReorganize: boolean;// 默认 true
    enableImageBrowser: boolean;      // 默认 true
    autoUploadOnPaste: boolean;       // 默认 false
    keepLocalCopy: boolean;           // 默认 false
}
```

### 默认值

```typescript
const DEFAULT_SETTINGS: ImageManagerSettings = {
    locale: 'en',
    imagePathTemplate: 'attachments',
    imagePathBase: 'note',
    supportedExtensions: ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'svg', 'webp', 'ico', 'tiff', 'avif'],
    autoCompress: false,
    compressQuality: 80,
    thumbnailSize: 200,
    imageNamingTemplate: 'image-{timestamp}',
    promptImageName: false,
    hostingConfigs: [],
    defaultHostingId: '',
    uploadPathTemplate: DEFAULT_UPLOAD_PATH_TEMPLATE,
    autoReplaceAfterUpload: false,
    reorganizeConvertFormat: true,
    skipWikiRefsOnReorganize: true,
    enableImageBrowser: true,
    autoUploadOnPaste: false,
    keepLocalCopy: false,
};
```

## 常量

```typescript
// src/constants.ts
MD_IMAGE_REGEX = /!\[([^\]]*)\]\(([^)]+)\)/g
WIKI_IMAGE_REGEX = /!\[\[([^\]|]+)(?:\|([^\]]*))?\]\]/g

IMAGE_MIME_TYPES: {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    bmp: 'image/bmp',
    webp: 'image/webp',
    svg: 'image/svg+xml',
    tiff: 'image/tiff',
    avif: 'image/avif',
    ico: 'image/x-icon',
}
```

## 远程对象公共类型

文件：`src/remote/types.ts`、`src/remote/provider.ts`、`src/remote/provider-factory.ts`

- `RemoteCapability`：`list | preview | delete`，每个 Provider 只公布已实现的能力。
- `RemoteObject`：只保存规范化的对象元数据，必须包含 `hostingId`、逻辑 `key`、`size`。
- `RemoteListRequest` / `RemoteListPage`：公共分页契约；`cursor` 是 Provider 拥有的不透明字符串，禁止公共层解析或二次编码。
- `RemoteDeleteResult`：保留 permanent、delete-marker 或 unknown 语义，不将服务商删除结果压缩为单一布尔值。
- `RemoteObjectProvider`：远程 list/preview/delete 接口，不继承也不修改 `UploaderBase`；可选 `referenceMapping` 由 Provider 提供服务商 API URL bases。
- `RemoteProviderFactoryResult`：`ready` / `unsupported` 判别联合；尚未实现的图床返回空能力集和结构化原因，调用者无需捕获异常。
- `RemoteUrlMapping`：一个 hosting 的 `urlPrefix`、CDN/source aliases 和 Provider 允许忽略的查询参数名；G2 仅作为运行时匹配输入，不写入设置。
- `RemoteReferenceScanSummary` / `RemoteReferenceIndexState`：提供 Markdown 扫描时间、计数、`.canvas` 覆盖状态和 `empty | fresh | stale` 生命周期。
- `RemoteObjectReferenceLookup`：按 `referenced`、`possibly-referenced`、`unmappable`、`not-referenced-in-current-vault` 的保守顺序分类对象；未扫描或 stale 时不产生未引用结论。

这些类型属于 Issue #17 的远程管理领域；既有 `ImageHostingConfig`、`UploadResult` 与上传器 API 在 G1 保持不变。

G3 增加 `RemoteBrowseSession`：会话保存 opaque cursor 和已访问页，下一页未缓存时只请求一页，上一页读取缓存；刷新替换当前页并丢弃其后的游标链。停止、范围变更和关闭会使迟到结果失效，但不承诺取消已经发送的 Provider HTTP 请求。

Issue #23 将 `RemoteBrowseSnapshot.error` 调整为结构化 `RemoteBrowseFailure`，只包含稳定错误码与可选 HTTP 状态；S3 Provider 不把 XML 错误正文或签名信息传给 UI。`RemoteProviderErrorCode` 新增 `configuration` 与 `not-found`。

## 新增设置项流程

1. 在 `ImageManagerSettings` 接口添加字段
2. 在 `DEFAULT_SETTINGS` 添加默认值
3. 在 `settings.ts` 的对应 `render*` 方法添加 UI 控件
4. 在 `i18n/en.ts` 和 `i18n/zh.ts` 添加翻译键
5. 在 `main.ts` 或相关 utils 中使用设置值
