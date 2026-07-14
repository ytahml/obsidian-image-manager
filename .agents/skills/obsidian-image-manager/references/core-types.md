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

## 新增设置项流程

1. 在 `ImageManagerSettings` 接口添加字段
2. 在 `DEFAULT_SETTINGS` 添加默认值
3. 在 `settings.ts` 的对应 `render*` 方法添加 UI 控件
4. 在 `i18n/en.ts` 和 `i18n/zh.ts` 添加翻译键
5. 在 `main.ts` 或相关 utils 中使用设置值
