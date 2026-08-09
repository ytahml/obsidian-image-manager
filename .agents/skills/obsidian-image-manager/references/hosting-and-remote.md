# 图床上传与远程对象管理

## 上传器架构

```text
UploaderBase
├── AliyunOSSUploader
├── QiniuUploader
├── S3Uploader
└── CustomUploader

UploadService    文件/数据上传、重试与结构化结果
UploadQueue      全库批量上传的 3 worker 与进度
ExplicitUploadWorkflow  单图、笔记、全库显式上传及结构化汇总
UploadReferenceManager  上传引用准备、渲染与普通 Vault 替换
upload-path.ts   原生图床共享路径模板
public-url.ts    公共 URL base 规范化与拼接
```

`createUploader(config, globalTemplate)` 是唯一工厂入口。新增原生图床时同时评估是否需要独立 Remote Provider；不要扩张 `UploaderBase` 处理管理权限。

## 上传路径与结果

原生图床模板优先级：

1. 图床 `uploadPath`
2. 全局 `uploadPathTemplate`
3. `DEFAULT_UPLOAD_PATH_TEMPLATE`

变量：`{year}`、`{month}`、`{day}`、`{filename}`、`{ext}`、`{hash}`、`{timestamp}`、`{sourceDir}`。

- `{hash}` 是文件内容 SHA-256 的前 16 位。
- `{sourceDir}` 是源图片相对 Vault 根的父目录；根文件为空且不能产生重复 `/`。
- 只有显式使用 `{sourceDir}` 时才把 Vault 目录名发送给服务商。
- Custom 不使用对象 key 模板，以响应 JSON path 提取 URL。

`UploadService` 统一文件/数据上传、压缩载荷、重试和结构化结果；它只通过 getter 读取压缩、质量和上传路径三项默认值，不依赖完整插件设置。调用分工为：

- `ExplicitUploadWorkflow`：当前图片、活动/指定笔记和全库批量上传。
- managed/delegated 管线：粘贴自动上传，因为它们需要不同的事务身份与安全重验。

笔记上传按解析出的 `TFile.path` 去重：同一图片只上传一次，但每处引用使用自己的 alt 生成替换文本。所有成功引用先一次写回当前笔记，写回成功后才替换其他笔记，降低当前笔记失败时的跨 Vault 部分更新范围。无法解析的引用和每张唯一图片的上传失败都进入结构化汇总。

重试只在统一编排层发生。`UploadQueue` 启动 3 个 worker，并为每文件向 Service 配置最多 3 次重试。成功 listener 只在完整成功后发布；失败不发布远程会话失效。

需要事务一致性的调用方可提供每次尝试前的异步验证。验证失败时 Service 在发出下一次请求前返回取消结果；普通手动、笔记和批量上传不提供该钩子，保持原重试策略。

原生成功必须同时有 URL 与 objectKey；Custom 保持 URL-only。操作结果可包含 attempts、originalSize、uploadedSize、hostingId，但不写入 `data.json` 上传清单。

## 公共 URL 与引用

`urlPrefix` 表示对象公开访问基础路径，可包含 bucket 或目录。缺少 scheme 时补 `https://`，拼接只清理边界斜杠：

- S3 不根据 `forcePathStyle` 自动追加 bucket。
- Qiniu 必须提供下载域名，公开和私有下载 URL 都基于该 base。
- Aliyun OSS 留空时可使用源站 URL；配置 CDN 时使用显式 base。
- Custom URL 完全来自响应。

网络 URL 保持安全百分号编码。生成 Markdown 时只还原 path 中合法的非 ASCII UTF-8，保留空格、`#`、`?`、`%`、括号、query 和 fragment 编码。

## 自定义引用模板

支持：

`{fileUrl}`、`{fileAlt}`、`{fileName}`、`{fileBaseName}`、`{fileExt}`、`{fileWidth}`、`{fileHeight}`

规则：

- 空白模板表示关闭。
- `{fileUrl}` 必填。
- 未知 `{identifier}` 使模板无效；普通非变量花括号允许。
- 只有结构有效且用到宽高时才读取固有尺寸。
- replacement 中的 `$&` 等字符串不得被解释为正则替换指令。
- 无效模板、尺寸无效或解码失败时回退标准 Markdown，不改变上传成功状态。
- 只影响上传后的远程引用，不改变本地粘贴、转换、重命名或整理。

`UploadReferenceManager.prepare()` 每张图片只解析一次所需尺寸，并返回可按不同 alt 重复渲染的 prepared reference；普通全 Vault 替换也集中在该模块。managed/delegated 的精确事务引用替换仍由各自管线执行。

## Provider 特有上传协议

### Aliyun OSS

- PUT 到 `https://{bucket}.{region}.aliyuncs.com/{encodedKey}`。
- 使用 OSS V4 `OSS4-HMAC-SHA256`、`x-oss-date` 与 `UNSIGNED-PAYLOAD`。
- 逻辑 key 保持 Unicode，请求 URI 与 canonical URI 使用同一逐段编码结果。
- 没有 additional headers 时 Authorization 不发送空的 `AdditionalHeaders=`。
- OSS canonical headers 的空字段换行是协议组成部分；修改前运行 canonical hash 回归测试。
- 连接测试使用 `ListObjectsV2(max-keys=1)`，不写对象也不遍历 bucket。

### Qiniu

- multipart POST，上传 token 为 HMAC-SHA1 签名 policy。
- policy 按 UTF-8 Base64URL；multipart `key` 保持逻辑路径，公开 URL 逐段编码。
- region 支持 z0/z1/z2/na0/as0。
- 公共访问 base 缺失时上传在发送请求前失败，避免返回不可访问 URL。

### S3-compatible

- PUT 使用 AWS SigV4，支持 path-style 和 virtual-hosted。
- endpoint 可含 base path；实际 URL 与 canonical URI 必须一致。
- query 名和值分别 AWS 编码后排序，空格为 `%20`，不能使用 `+`。
- R2 endpoint 的空 region 规范化为 `auto`；其他 endpoint 要求显式 region。
- MinIO 常见 region 为 `us-east-1`，但实际配置必须与服务端一致。
- 连接测试使用 `ListObjectsV2(max-keys=1)`，只测试 list 权限。

### Custom

- POST multipart 或 PUT raw body。
- 可配置 headers、file field、extra body 和响应 JSON path。
- 不要求 objectKey，不推断 key，不参与 remote Provider registry。

## 远程 Provider 边界

`RemoteObjectProvider` 独立暴露 `list | folders | preview | delete` capability。`createRemoteObjectProvider()` 对未知或未注册类型返回结构化 unsupported，不用异常表达 UI 能力。

生产 registry：

| 类型 | list | folders | preview | delete |
|---|---:|---:|---:|---:|
| Aliyun OSS | 是 | 是 | 是 | 是 |
| Qiniu Kodo | 是 | 是 | 是 | 是 |
| S3-compatible | 是 | 是 | 是 | 是 |
| Custom | 否 | 否 | 否 | 否 |

`RemoteRequestClient` 是 `requestUrl` 的可注入边界。`RemoteProviderError` 只发布分类、HTTP status、retryable 与去除账号/query/fragment 的 endpoint，不保留原始响应正文或 headers。

## 扫描会话与结果

初始打开、切换图床和打开文件夹选择器以外的浏览器初始化不能自动扫描对象。

用户显式扫描后：

- Provider 单次 `limit` 最多 1000。
- `RemoteBrowseSession` 每批最多连续发出 10 次 list 请求，然后暂停等待继续。
- cursor 原样透传；truncated=true 但没有 usable cursor 是协议错误。
- stop、scope 变化、refresh、关闭会话通过 generation 隔离迟到结果；当前接口不承诺取消已发出的 HTTP。
- refresh 从当前 prefix 第一页重扫。
- prefix 去除首尾 `/`；请求时按 Provider 规则形成目录边界，不能误包含相邻前缀。

搜索、排序、引用状态筛选在完整已扫描集合执行。结果无本地页码；卡片首批 60 张，滚动时每批追加 60。

### 虚拟目录

目录选择与递归对象扫描是不同请求：

- S3/OSS 使用 `delimiter=/` 解析 `CommonPrefixes`。
- Qiniu `/list` 的 `delimiter`/`marker` 语义由 Provider 规范化。
- 只列当前层，支持根、面包屑、进入子目录、继续加载和选择当前目录。
- Provider 返回超出请求层级或 scope 的 prefix 必须拒绝。
- 手动 prefix 输入继续作为高级备用。

## 预览与流量

- 图片卡片接近 viewport 前约 200px 才请求预览 URL。
- `RemoteThumbnailSession` 最多 4 个 URL 解析并发。
- 同一对象的缩略图与大图共享进行中的 URL 请求和未临近过期的缓存。
- 只有实际设置 `<img src>` 时计入会话图片请求数。
- 搜索/排序/筛选可重建观察器，但应复用仍有效 URL。
- 切换 hosting/prefix、refresh、close 会清除 URL 并隔离迟到签名与 load/error 事件。
- 私有临时 URL 有 300 秒有效期，接近安全窗口时重签。
- 公开模式只使用 `urlPrefix`，缺失时提示配置问题，不猜 ACL、不回退到 endpoint。

Provider 差异：

- S3：300 秒 SigV4 presigned GET，只签 host，payload 为 `UNSIGNED-PAYLOAD`。
- OSS：300 秒 V4 presigned GET；Archive、ColdArchive、DeepColdArchive 不自动预览。
- Qiniu：基于下载域名生成公开 URL 或 300 秒 private download token。

远程预览显示完整 object key、大小/时间/存储状态、引用位置和流量状态；点击引用行号打开笔记并定位。

## 远程引用索引

索引只扫描 Markdown 文件，并在用户触发的远程流程中按需建立。Vault Markdown create/modify/delete/rename 后变 stale，不后台自动重扫。

以下语法只要 URL 能可靠映射，都标为 `referenced`：

- Markdown 图片
- 普通 Markdown 链接
- HTML 属性/文本
- frontmatter
- Wiki 包裹
- 裸 URL

索引记录 note path 与一基显示前转换的行位置。query values 不进入索引或错误，仅可保留 query parameter 名。Provider mapping 可声明应忽略的 query 名。

映射原则：

- 使用 Provider 的主 `urlPrefix`、源站 base 和 `publicUrlAliases`。
- alias 一行一个 HTTP(S) base，不能含账号、query、fragment，必须截止 object key 前。
- 不按 basename 猜测，不把相邻 path prefix 当命中。
- encoded slash、double-encoded percent 等必须保持可区分。
- 索引完成前、stale、abort 或 mapping 歧义不能声明未引用。

## 删除安全

可选择条件必须全部满足：

1. remote management enabled。
2. Provider 有 delete capability。
3. 引用索引为 fresh。
4. object hostingId 与当前配置一致。
5. key 在当前 prefix 目录边界内。
6. object 属于当前 scan snapshot。
7. 引用状态为 `not-referenced-in-current-vault`。

执行边界：

- 最多选择 20 项。
- 创建 batch 后记录配置、prefix、scan/index 时间；执行前验证漂移。
- 确认 Modal 要求输入精确数量并勾选不可撤销确认。
- 最多 2 并发，无自动重试。
- stop 后不调度未发送项，但保留 in-flight 结果。
- 逐对象发送 exact-key delete，不使用批量 DeleteObjects，不附加 versionId/MFA/Object Lock 绕过参数。
- 用户成功文案为“请求成功”；204/200 不能证明永久释放空间。
- 请求接受后失效列表、预览与选择，用户重新扫描验证远端。

Provider 删除语义：

- S3/OSS：204；delete-marker header 可映射 `delete-marker`，否则 `unknown`。
- Qiniu：对 EncodedEntryURI 发送单对象 delete；保留 Provider 稳定失败映射。

每项完成后由串行 writer 保存脱敏 audit，按完成时间倒序最多 200 条。持久化失败不能破坏后续写入；audit 永不参与存在、引用或删除判断。

## 安全测试重点

修改图床或远程代码时至少覆盖相关项：

- 特殊字符 key 的实际 URL 与 canonical request 一致。
- opaque cursor 只编码 Provider 要求的一次。
- path-style/virtual-hosted/base-path、R2/MinIO 差异。
- OSS canonical newline 与 Qiniu management 尾部双换行。
- 公共/私有预览和到期重签。
- late response/session invalidation。
- 广义 URL 语法、alias、query 脱敏、encoded slash。
- fresh/stale/abort、prefix 边界、20/2 限制、部分失败与 stop。
- 原始错误、凭据、签名 query 不进入用户结果或 audit。
