# 图床上传器体系

## 架构

```
UploaderBase（抽象基类）
├── AliyunOSSUploader
├── QiniuUploader
├── S3Uploader
└── CustomUploader

createUploader(config)  ← 工厂函数
UploadQueue             ← 并发队列
```

## 抽象基类：`uploader-base.ts`

```typescript
abstract class UploaderBase {
    abstract readonly name: string;
    protected config: ImageHostingConfig;

    constructor(config: ImageHostingConfig);

    abstract upload(data: ArrayBuffer, filename: string): Promise<UploadResult>;
    abstract testConnection(): Promise<boolean>;
}
```

## 4 种上传器实现

### AliyunOSS (`aliyun-oss.ts`)

- **协议**：直接 PUT 请求
- **签名**：HMAC-SHA1 签名 `Authorization: OSS` 头
- **上传路径**：模板变量替换（含 SHA-256 hash）
- **端点**：`https://{bucket}.{region}.aliyuncs.com`

### 七牛云 (`qiniu.ts`)

- **协议**：multipart POST
- **签名**：HMAC-SHA1 签名 policy（upload token）
- **区域端点**：
  - `z0` → 华东
  - `z1` → 华北
  - `z2` → 华南
  - `na0` → 北美
  - `as0` → 东南亚
- **上传路径**：`https://{region}.qiniup.com`

### S3 兼容 (`s3-compatible.ts`)

- **协议**：PUT 请求
- **签名**：AWS Signature V4（`AWS4-HMAC-SHA256`）
- **URL 风格**：
  - path-style：`https://{endpoint}/{bucket}/{key}`
  - virtual-hosted：`https://{bucket}.{endpoint}/{key}`
- **配置**：`forcePathStyle` 可选

### 自定义 (`custom-uploader.ts`)

- **协议**：POST（multipart）或 PUT（raw body）
- **配置**：
  - `uploadUrl`：上传地址
  - `method`：POST/PUT
  - `headers`：自定义请求头
  - `fileFieldName`：文件字段名
  - `extraBody`：额外表单字段
  - `jsonPath`：从响应中提取 URL 的路径

## 工厂函数：`uploader-factory.ts`

```typescript
function createUploader(config: ImageHostingConfig): UploaderBase {
    switch (config.type) {
        case 'aliyun-oss': return new AliyunOSSUploader(config);
        case 'qiniu': return new QiniuUploader(config);
        case 's3': return new S3Uploader(config);
        case 'custom': return new CustomUploader(config);
    }
}
```

## 并发队列：`upload-queue.ts`

```typescript
class UploadQueue {
    private concurrency = 3;  // 3 并发 worker
    private MAX_RETRIES = 3;  // 每文件最多 3 次重试

    addFiles(files: TFile[]): void;
    onProgressChange(callback: (progress: QueueProgress) => void): void;
    start(hostingConfig: ImageHostingConfig): Promise<UploadHistoryEntry[]>;
}
```

### QueueItem 状态机

```
pending → uploading → done
                   ↘ failed（重试后仍失败）
         pending ← uploading（重试：retries < 3）
```

### 进度回调

```typescript
interface QueueProgress {
    total: number;
    completed: number;
    failed: number;
    current: string;  // 当前上传的文件名
}
```

### 上传历史

```typescript
interface UploadHistoryEntry {
    timestamp: number;
    fileName: string;
    filePath: string;
    hostingName: string;
    url: string;
    originalSize: number;
    uploadedSize: number;
}
```

## 新增图床服务商步骤

1. **创建上传器**：`src/uploaders/{name}.ts`
   - 继承 `UploaderBase`
   - 实现 `upload(data, filename)` → `UploadResult`
   - 实现 `testConnection()` → `boolean`
   - 使用 `requestUrl` 发送 HTTP 请求（Obsidian API）

2. **注册工厂**：`src/uploaders/uploader-factory.ts`
   - 添加 `case '{type}': return new {Name}Uploader(config);`

3. **添加配置类型**：`src/types.ts`
   - 定义 `{Name}Config` 接口
   - 更新 `ImageHostingConfig.config` 联合类型

4. **添加配置 UI**：`src/modals/hosting-config.ts`
   - 在 `HostingType` 下拉添加选项
   - 添加对应的配置字段渲染

5. **添加翻译**：`src/i18n/en.ts` + `src/i18n/zh.ts`

## 加密说明

- **阿里云 OSS**：`crypto.subtle.importKey` + `crypto.subtle.sign`（HMAC-SHA1）
- **七牛云**：`crypto.subtle.importKey` + `crypto.subtle.sign`（HMAC-SHA1）
- **S3**：`crypto.subtle.importKey` + `crypto.subtle.sign`（HMAC-SHA256）+ 多步派生
- **自定义**：无签名，依赖用户配置的 headers

所有加密均使用 Web Crypto API（`crypto.subtle`），不依赖 Node.js `crypto` 模块。
