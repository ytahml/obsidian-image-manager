# 图床上传器体系

## 架构

```
UploaderBase（抽象基类）
├── AliyunOSSUploader
├── QiniuUploader
├── S3Uploader
└── CustomUploader

createUploader(config)  ← 工厂函数
upload-path.ts          ← 共享模板解析与优先级
oss-path.ts             ← Aliyun OSS 对象 key URL 编码
public-url.ts           ← 公共访问 URL 基础路径规范化与拼接
upload-service.ts       ← 单图、笔记、批量、粘贴上传的统一编排与结构化结果
UploadQueue             ← 并发队列
```

## 抽象基类：`uploader-base.ts`

```typescript
abstract class UploaderBase {
    abstract readonly name: string;
    protected config: ImageHostingConfig;

    constructor(config: ImageHostingConfig);

    abstract upload(data: ArrayBuffer, filename: string, context?: UploadContext): Promise<UploadResult>;
    abstract testConnection(): Promise<boolean>;
}
```

### 上传路径模板

`upload-path.ts` 统一为 Aliyun OSS、Qiniu、S3 解析模板。自定义图床不使用该模板，公开 URL 以响应 JSON 为准。优先级为：

1. 图床配置 `uploadPath`
2. 全局 `uploadPathTemplate`
3. `DEFAULT_UPLOAD_PATH_TEMPLATE`

支持 `{year}`、`{month}`、`{day}`、`{filename}`、`{hash}`、`{ext}`、`{timestamp}` 和 `{sourceDir}`。`{sourceDir}` 是图片相对于 Vault 根目录的父目录；根目录图片解析为空且不会产生重复斜杠。只有显式使用该变量时，Vault 目录名才会进入远端对象 key。

## 4 种上传器实现

### AliyunOSS (`aliyun-oss.ts`)

- **协议**：直接 PUT 请求
- **签名**：OSS V4，使用 HMAC-SHA256 和 `Authorization: OSS4-HMAC-SHA256` 头
- **上传路径**：模板变量替换（含 SHA-256 hash）
- **路径编码**：逻辑对象 key 保持 Unicode；请求 URL 与 V4 Canonical URI 使用相同的逐段编码结果
- **V4 头部**：`x-oss-date`、`x-oss-content-sha256: UNSIGNED-PAYLOAD`；Canonical URI 为 `/{bucket}/{encodedKey}`；没有附加签名头时必须从 Authorization 中省略 `AdditionalHeaders` 字段，不能发送空的 `AdditionalHeaders=`；Canonical Headers 后仍需保留 OSS 规定的空字段换行，服务端 Canonical Request 在 `x-oss-date` 与 payload 之间包含 3 个 LF
- **端点**：`https://{bucket}.{region}.aliyuncs.com`
- **共享签名层**：`src/oss/sigv4.ts` 同时服务 PUT 上传、ListObjectsV2、300 秒私有预览与 DeleteObject；请求 URL、canonical URI、canonical query 与发送 headers 从同一结果生成。连接测试使用 `ListObjectsV2(max-keys=1)`，不会遍历 Bucket。
- **远程管理**：`aliyun-oss-remote.ts` 支持 opaque continuation token、`CommonPrefixes` 虚拟目录、源站/`urlPrefix`/alias 引用映射、公开或私有预览与单对象删除。204 仅报告 `delete-marker` 或 `unknown`，不发送 versionId 或批量删除；Archive、ColdArchive、DeepColdArchive 默认不预览。

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
- **特殊字符**：policy 先按 UTF-8 编码后再 Base64URL，multipart `key` 保留逻辑路径，公开 URL 按路径段编码
- **公开 URL**：必须配置公共访问 URL 基础路径
- **远程管理**：`src/qiniu/auth.ts` 与上传 token 共用 Base64URL/HMAC 基础能力，但管理 API 使用独立的 `Qiniu <accessKey>:<signature>` 请求签名与 `X-Qiniu-Date`；签名输入必须保留协议要求的两个结尾换行。`qiniu-remote.ts` 以 `/list` 的 `marker` 作为不透明游标，支持虚拟目录、公开 URL 和 300 秒私有下载 token 预览，以及 `POST /delete/<EncodedEntryURI>` 的单对象删除。上传、管理和私有下载权限不得混为同一用途。

### S3 兼容 (`s3-compatible.ts`)

- **协议**：PUT 请求
- **签名**：AWS Signature V4（`AWS4-HMAC-SHA256`）
- **路径编码**：`s3-path.ts` 按 AWS SigV4 的未保留字符集对 key 逐段编码，请求 URL 与 canonical URI 必须使用相同结果
- **URL 风格**：
  - path-style：`https://{endpoint}/{bucket}/{key}`
  - virtual-hosted：`https://{bucket}.{endpoint}/{key}`
- **配置**：`forcePathStyle` 可选
- **公开 URL**：`urlPrefix` 完全由用户配置，不根据 `forcePathStyle` 自动追加 bucket
- **共享签名层**：`src/s3/sigv4.ts` 同时服务 PUT 上传、ListObjectsV2、presigned GET 和 DeleteObject；请求 URL、endpoint base path、Canonical URI、Canonical Query 与实际发送 headers 从同一结果生成
- **查询编码**：query 名称和值分别按 AWS 规则编码，编码后排序，空格使用 `%20`；opaque continuation token 只编码一次
- **连接测试**：使用 `ListObjectsV2` 的 `max-keys=1` 非破坏请求，不自动遍历 Bucket
- **虚拟目录**：远程管理的文件夹选择器发送 `delimiter=/` 并解析 `CommonPrefixes`；每次只读取当前层级且按 continuation token 加载更多，不影响递归图片扫描
- **R2 region**：配置非空时原样使用；R2 endpoint 的空 region 规范化为 `auto`，其他 S3 endpoint 仍要求显式 region
- **MinIO region 提示**：保持 region 显式配置；设置界面提示 MinIO 通常使用 `us-east-1`，实际值仍须与服务端配置一致
- **缩略图与大图预览**：私有模式使用同一请求目标和 signing key 派生逻辑生成 300 秒 SigV4 presigned GET，只签 `host` 并使用 `UNSIGNED-PAYLOAD`；公开模式只用 `urlPrefix + encoded key`，不受 `forcePathStyle` 影响且不会从签名失败回退
- **远程删除**：共享 header SigV4 层对列表返回的完整 key 发送单对象 `DELETE` 和空 payload hash；不发送 versionId、MFA、条件头或 Object Lock/retention 绕过参数，不使用 DeleteObjects，不自动更换 endpoint、region 或 URL style
- **删除结果**：仅 204 表示请求已接受；`x-amz-delete-marker: true` 映射为 `delete-marker`，其他 204 映射为 `unknown`，从不显示永久删除。401/403/404/409/412/423/429/5xx 与网络错误映射为稳定脱敏失败码

### 公共访问 URL 与 Markdown 显示

- `urlPrefix` 表示公共访问 URL 基础路径，可包含 bucket 或目录；缺少协议时补 `https://`，拼接时只清理边界斜杠。
- 上传结果保留网络安全的编码 URL。生成 Markdown 引用时仅还原路径中的非 ASCII UTF-8 字符，空格、`#`、`?`、`%`、括号等仍保持百分号编码。

### 自定义 (`custom-uploader.ts`)

- **协议**：POST（multipart）或 PUT（raw body）
- **配置**：
  - `uploadUrl`：上传地址
  - `method`：POST/PUT
  - `headers`：自定义请求头
  - `fileFieldName`：文件字段名
  - `extraBody`：额外表单字段
  - `jsonPath`：从响应中提取 URL 的路径

Custom 固定为仅上传能力：不要求返回 `objectKey`，不从响应 URL 推断 key，也不接入 list/preview/delete。未来出现稳定服务协议时应新增原生 Provider 类型。

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

G6 已由统一 `UploadService` 承接单图、笔记、批量和粘贴上传；`UploadQueue` 只负责批量并发、重试和进度，并复用该 Service 的执行与结果语义。原生图床结果返回稳定的 `hostingId` 与 `objectKey`，Custom 保持 URL-only。结果只在当前操作内汇总，不写入 `data.json` 或独立上传清单；成功后只使对应 hosting 的已打开远程会话失效，远端事实仍以用户下一次扫描为准。笔记上传通过 `note-images.ts` 读取并解析所选笔记：活动笔记使用编辑器内存文本，其他笔记读取 Vault 文件，避免 `cachedRead()` 延迟；本地引用先逐段完整 URL 解码，再用 Obsidian linkpath 语义解析，并保留旧版 Vault 根路径兼容回退，因此无需先执行“整理图片资源”。它还会聚合未解析本地文件、上传结果失败和异常。若任一失败，最终 Notice 显示成功/失败计数及首个安全摘要（HTTP 状态和服务商错误码），而不是只显示 `0/N` 成功。

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

- **阿里云 OSS**：`crypto.subtle.digest` + `crypto.subtle.sign`（SHA-256 / HMAC-SHA256，多步派生 V4 signing key）
- **七牛云**：`crypto.subtle.importKey` + `crypto.subtle.sign`（HMAC-SHA1）
- **S3**：`crypto.subtle.importKey` + `crypto.subtle.sign`（HMAC-SHA256）+ 多步派生
- **自定义**：无签名，依赖用户配置的 headers

所有加密均使用 Web Crypto API（`crypto.subtle`），不依赖 Node.js `crypto` 模块。
