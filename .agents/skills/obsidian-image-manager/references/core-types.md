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
    pageSize: number;                 // 旧 data.json 兼容；卡片网格不再分页
    previewMode: 'manual' | 'viewport'; // 统一规范化为 viewport
    previewAccess: 'presigned' | 'public'; // 旧配置默认 presigned
    publicUrlAliases: string[];       // 仅用于 CDN、旧域名或其他公开域名的引用映射
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
    objectKey?: string; // G6：原生图床成功时返回；Custom 不要求且不得从 URL 猜测
    error?: string;
    originalPath: string;
}
```

G6 计划不持久化上传结果或上传清单。`objectKey` 只用于当前操作的统一结果处理和对应远程会话失效；远端对象当前是否存在仍由 Provider 重新扫描确认。

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
    customReferenceTemplate: string;  // 上传后自定义引用模板；{url} 必填，支持 {alt}
    reorganizeConvertFormat: boolean; // 默认 true（关键门控设置）
    skipWikiRefsOnReorganize: boolean;// 默认 true
    enableImageBrowser: boolean;      // 默认 true
    autoUploadOnPaste: boolean;       // 默认 false
    keepLocalCopy: boolean;           // 默认 false
    remoteDeleteHistory: RemoteDeleteAuditEntry[]; // 最近 200 条脱敏远程删除结果
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
    remoteDeleteHistory: [],
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
- `RemoteDeleteFailureCode`：复用结构化 Provider 错误码并增加 `conflict | precondition | locked`；删除结果不含任意错误字符串。
- `RemoteDeleteAuditEntry`：持久化时间、hostingId、完整 key、成功状态、HTTP 状态、删除语义或稳定失败码；不保存 endpoint、完整 URL、凭据或响应正文。
- `RemoteObjectProvider`：远程 list/preview/delete 接口，不继承也不修改 `UploaderBase`；可选 `referenceMapping` 由 Provider 提供服务商 API URL bases。
- `RemotePreviewUrl`：缩略图或大图预览返回的会话内 URL，包含明确的 `presigned | public` 访问方式和可选到期时间；不得持久化或写入日志。
- `RemoteProviderFactoryResult`：`ready` / `unsupported` 判别联合；尚未实现的图床返回空能力集和结构化原因，调用者无需捕获异常。
- `RemoteUrlMapping`：一个 hosting 的 `urlPrefix`、CDN/source aliases 和 Provider 允许忽略的查询参数名；G2 仅作为运行时匹配输入，不写入设置。
- `RemoteReferenceScanSummary` / `RemoteReferenceIndexState`：提供 Markdown 扫描时间、计数和 `empty | fresh | stale` 生命周期；远程引用管理不扩展到非 Markdown 文件。
- `RemoteObjectReferenceLookup`：任何可可靠映射的 Markdown 图片、普通链接、HTML、frontmatter、Wiki 包裹或原始 URL 都分类为 `referenced`；同时通过 `getReferences()` 返回笔记路径、0-based 行号和语法来源。完全未命中才返回 `not-referenced-in-current-vault`，未扫描、stale 或映射歧义仍返回 `unmappable`。`possibly-referenced` 仅作为旧公共类型兼容值，不再由当前索引产生。
- `RemoteFolderListRequest` / `RemoteFolderListPage`：Provider 无关的单层虚拟目录分页契约；返回完整规范化前缀并保留不透明 cursor。S3 的实现只从 `CommonPrefixes` 生成目录，不把 `Contents` 猜测为文件夹。

这些类型属于 Issue #17 的远程管理领域；既有 `ImageHostingConfig`、`UploadResult` 与上传器 API 在 G1 保持不变。

G3 增加 `RemoteBrowseSession`；Issue #23 合并后改为自动批次扫描：会话保存 opaque cursor 和已读取页，每个远端请求最多 1000 项，每最多 10 次请求暂停并允许继续。已读取页聚合为一个本地结果集。Issue #26 的体验重构移除本地分页：搜索、排序和引用状态筛选作用于完整集合，卡片每次渐进追加 60 项。停止、范围变更和关闭会使迟到结果失效，但不承诺取消已经发送的 Provider HTTP 请求。

Issue #23 将 `RemoteBrowseSnapshot.error` 调整为结构化 `RemoteBrowseFailure`，只包含稳定错误码与可选 HTTP 状态；S3 Provider 不把 XML 错误正文或签名信息传给 UI。`RemoteProviderErrorCode` 新增 `configuration` 与 `not-found`。

Issue #26 的预览增加 `RemotePreviewSession`：公开模式只使用 `urlPrefix`，私有模式缓存 300 秒 presigned GET；距到期不足 30 秒或用户重试时重新生成。`RemoteThumbnailSession` 为进入可视区域的卡片提供 4 并发 URL 解析队列；缩略图和独立大图预览共用会话 URL 缓存。关闭、切换配置、修改前缀和刷新会清空缓存并隔离迟到结果。

Issue #26 的删除闭环增加 `RemoteDeleteSession` 与 Provider 无关策略：只接受 fresh Markdown 索引的 `not-referenced-in-current-vault` 对象；校验 hostingId、目录前缀和当前扫描集合；20 项硬上限、2 并发、无自动重试。`remoteDeleteHistory` 旧配置默认空数组，逐项完成后串行保存并截断为最近 200 条。它严格定位为“本地诊断记录”，当前没有历史 UI，不是远程事实来源，也不参与任何删除安全门禁。

## 新增设置项流程

1. 在 `ImageManagerSettings` 接口添加字段
2. 在 `DEFAULT_SETTINGS` 添加默认值
3. 在 `settings.ts` 的对应 `render*` 方法添加 UI 控件
4. 在 `i18n/en.ts` 和 `i18n/zh.ts` 添加翻译键
5. 在 `main.ts` 或相关 utils 中使用设置值
