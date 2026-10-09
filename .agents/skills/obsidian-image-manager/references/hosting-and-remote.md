# 图床上传与远程对象管理

## 上传器架构

```text
UploaderBase
├── AliyunOSSUploader
├── QiniuUploader
├── S3Uploader
└── CustomUploader

UploadService    文件/数据上传、重试与结构化结果
UploadQueue      范围上传的 3 worker、逐项身份/结果与完成进度
upload-scope.ts   全库/递归文件夹/文章笔记范围、图片去重与源版本快照
ExplicitUploadWorkflow  单图、范围显式上传及分阶段结构化汇总
UploadReferenceManager  上传引用准备、渲染与普通 Vault 替换
UploadLocalCleanup      显式上传按模式偏好与 fresh 引用检查回收本地副本
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

- `ExplicitUploadWorkflow`：当前图片，以及全库/递归文件夹/文章笔记范围上传。
- managed/delegated 管线：粘贴自动上传，因为它们需要不同的事务身份与安全重验。

范围上传只注册统一的 `batch-upload` 命令，打开时默认全库；文章/文件夹右键打开同一弹窗并预选被点击范围。范围只选择 Markdown 笔记；收集可唯一解析且扩展名受支持的本地图片，按 `TFile.path` 去重，不限制附件所在目录、不上传孤立图片。每处引用保留自己的 alt。开启本次引用替换时，成功图片在全库 Markdown 的引用一起更新，包括范围外笔记；关闭时不改任何笔记。

`UploadPlan` 保存源 TFile、路径、mtime/size。队列结果始终绑定源快照，不能按服务商 `originalPath`（可能仅文件名）或完成顺序找文件。上传前、重试前及采用结果/写回时重验身份与版本。每篇笔记一次聚合处理成功图片，打开的笔记通过当前 Editor 写回，其他笔记通过 `vault.process` 比较快照；分歧/冲突保留原文。单篇失败不阻断其他独立笔记，不承诺跨文件事务或“先当前笔记再其他笔记”。

汇总分别报告上传成功/失败、成功但未采用的源结果、更新笔记/引用/范围外笔记数，以及扫描跳过、笔记冲突/读写失败。显式上传共用当前模式的 `managedKeepLocalCopy` / `delegatedKeepLocalCopy`，不受粘贴自动上传开关门控，禁止重叠显式上传；managed/delegated 自动上传保留原有事务路径。

`UploadLocalCleanup` 在操作开始捕获模式与保留偏好。关闭保留时，只有成功且至少一处引用实际写回的源图片才可回收；本次引用写回存在任何冲突/失败时保守保留全部候选。未开启替换、零替换、未采用的源结果均保留。回收前重验模式/偏好、源身份/版本与生命周期保护，并做两次全库孤立扫描；扫描期间文件集/版本、打开 Editor 集合/绑定/内容发生变化或多个 Editor 分歧则保留。最终仅调用 `fileManager.trashFile()`，不删除目录。`localCopies` 独立报告回收、保留/跳过及检查/操作失败数量，不能把回收失败当作上传失败。

重试只在统一编排层发生。`UploadQueue` 启动 3 个 worker，并为每文件向 Service 配置最多 3 次重试。队列保存失败项，完成进度包含成功和失败。成功 listener 只在上传成功后发布；失败不发布远程会话失效。

需要事务一致性的调用方可提供每次尝试前的异步验证。验证失败时 Service 在发出下一次请求前返回取消结果；显式单图和范围上传同样提供源身份/版本验证，不放宽既有重试上限。

原生成功必须同时有 URL 与 objectKey；Custom 保持 URL-only。操作结果可包含 attempts、originalSize、uploadedSize、hostingId，但不写入 `data.json` 上传清单。

## 公共 URL 与引用

`urlPrefix` 表示对象公开访问基础路径，可包含 bucket 或目录。缺少 scheme 时补 `https://`，拼接只清理边界斜杠：

- S3 不根据 `forcePathStyle` 自动追加 bucket。
- Qiniu 必须提供下载域名，公开和私有下载 URL 都基于该 base。
- Aliyun OSS 留空时可使用源站 URL；配置 CDN 时使用显式 base。
- Custom URL 完全来自响应。

网络 URL 保持安全百分号编码。生成 Markdown 时只还原 path 中合法的非 ASCII UTF-8，保留空格、`#`、`?`、`%`、括号、query 和 fragment 编码。

`migrate-url-prefix` 命令把「以旧基础路径为前缀」的远程引用批量改写为新基础路径，用于换域名等 object key 不变的场景。入口有两个：命令面板命令，以及编辑已有图床时「公共访问 URL 基础路径」字段旁的显式「迁移历史引用」按钮（打开预填弹窗，保存配置本身不自动弹）；旧基础路径通过配置上的 `previousUrlPrefix` 跨「先清空再填新值」会话保留。匹配要求 origin 精确相等且路径按 segment 边界（`pathname` 等于旧路径或以 `旧路径 + "/"` 开头），替换保留对象路径、query 与 fragment；Markdown 行内图片与链接精确定位 URL（含尖括号包裹且带括号的 URL），保留标题并避免相邻引用合并，其余 URL 复用远程引用索引口径，写入复用快照写回，冲突保留原文。它不触发网络请求、不读取对象或凭据，也不改变 `publicUrlAliases` 只用于识别的语义。

迁移弹窗输入变化时立即失效旧计划；切换范围或目标时清除待执行的防抖计时器，过期预览在更新界面前返回，异步结果返回后再次核对版本。

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
| --- | ---: | ---: | ---: | ---: |
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

搜索、排序、引用状态筛选在完整已扫描集合执行。远程浏览器记忆所有图床共享的最后排序字段与方向；名称（key）、大小和修改时间支持升序/降序。修改时间缺失的对象始终最后，主值相同时按 key 升序稳定排序。方向切换只重排内存结果，不触发 list 请求。结果无本地页码；卡片首批 60 张，滚动时每批追加 60。

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

- “选择当前结果”只加入当前搜索与引用筛选结果中的可删除对象；“清空选择”清除包括当前隐藏项在内的全部选择。
- 普通复选框点击建立 Shift 锚点；Shift 点击另一复选框按完整内存结果的当前筛选/排序顺序选择或取消区间中的可删除对象，不能依赖渐进渲染的 DOM 卡片。搜索、筛选、排序或扫描结果变化会清除锚点；搜索结果应用时也会清除防抖期间重新建立的锚点，而不清空已有选择。普通卡片单击切换当前项选中/取消，Ctrl/Cmd + 单击同样切换当前项选中/取消，不清除其他可见或隐藏选择；卡片手势复用同一资格重验和锚点入口，Shift + 单击卡片与复选框采用相同的区间选中/取消规则；Ctrl/Cmd + Shift 只追加区间。双击卡片或独立预览按钮只打开预览；共享卡片手势处理器在原生第二次 click 时撤销首击实际改变的各项选择（含 Shift 区间）并恢复锚点。`applyRemoteSelectionGesture()` 返回撤销回调，仅记录变化 ID；恢复时重新取得删除上下文并调用 `replaceSelection()` 重验，不绕过 fresh/scope/snapshot 等资格校验，不覆盖区间外的变化或整个集合。不可删除但支持预览的对象仍可预览，不支持预览的对象不因手势变化绕过能力限制。复选框/标签、预览与重试按钮的 click/dblclick 隔离，重试子控件的键盘事件不触发缩略图预览。
- 选择数量不设上限；无论选择多少对象，都不能放宽逐对象资格验证、精确数量确认、两请求并发和无自动重试边界。
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
- fresh/stale/abort、prefix 边界、无选择数量上限、2 并发、部分失败与 stop。
- 原始错误、凭据、签名 query 不进入用户结果或 audit。
