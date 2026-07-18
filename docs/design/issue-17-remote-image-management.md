# Issue #17 图床远程对象管理持续实施计划

> 对应 Issue：<https://github.com/ytahml/obsidian-image-manager/issues/17>
>
> 文档状态：G0–G4、S3-1～S3-3 已完成；S3 列举、浏览器接入及公开/私有手动预览均已通过 Cloudflare R2 与 MinIO 验收。
>
> 使用方式：后续新会话先完整阅读项目 `SKILL.md` 和本文，再从“进度总表”中选择一个未完成阶段推进。完成阶段后必须回写状态、验证证据和决策记录。

> S3 后续交付约定：剩余 S3 删除与兼容性收尾统一由子 Issue [#26](https://github.com/ytahml/obsidian-image-manager/issues/26) 跟踪，并持续使用分支 `feat/issue-26-s3-remote-management`，直到 S3-4～S3-5 全部完成；不再为内部 S3 小阶段创建额外 Issue 或分支。

## 1. 目标与产品结论

Issue #17 希望图片浏览器可以在“本地图片”和“图床图片”之间切换，并能识别、删除图床中的孤立对象。

项目接受该功能方向，但实现目标不是把完整的云存储控制台复制到 Obsidian，而是提供一个受范围约束、默认节流、删除保守的远程图片管理能力：

1. 用户必须先选择一个已配置图床和明确的管理范围。
2. 只有用户明确开始扫描后才自动分批列举范围内的对象元数据，始终不自动加载远程图片。
3. 将远程对象与当前 Vault 中检测到的引用进行比对。
4. 默认使用“当前 Vault 未检测到引用”，不直接宣称对象是垃圾文件。
5. 远程预览按需加载；删除能力单独启用并二次确认。
6. 首个开发与发布目标为 S3-compatible，优先验证 Cloudflare R2 与 MinIO；其他图床在 S3 首版稳定后独立推进。

### 1.1 每个 Vault 独立图床的落实方式

Issue 提交者建议每个 Obsidian Vault 使用独立图床。计划认可这种建议，但不会把它当作插件可以自动验证的事实。

管理范围由当前 S3 图床配置的 Bucket 和可选目录前缀共同确定：

| 前缀 | 管理范围 | 风险提示 | 删除要求 |
|------|----------|----------|----------|
| 非空，例如 `obsidian/vault-a/` | 仅列举该前缀下的对象 | 显示当前 Bucket 与前缀摘要 | 始终二次确认 |
| 空 | 当前配置 Bucket 的根范围 | 每个图片浏览器会话首次扫描前提示请求、流量和误判风险 | 始终二次确认 |

空前缀是合法配置，不阻止保存，也不代表插件认定该 Bucket 为当前 Vault 独占。即使用户使用独立 Bucket，也不能自动删除，因为对象仍可能被网站、发布系统、其他应用或插件未覆盖的语法引用。

### 1.2 首期明确不做

- 不在打开图片浏览器或切换到远程标签时自动扫描。
- 不在无确认的情况下扫描整个 Bucket；空前缀必须由用户手动发起并确认。
- 不默认加载所有缩略图或原图。
- 不根据“当前 Vault 未检测到引用”自动删除。
- 不要求四种图床同时达到相同成熟度后才能发布。
- 不把上传清单当作远程对象真实列表的替代品。
- 不执行用户提供的 JavaScript、远程脚本或动态签名代码。
- 不与尚未实现的图床迁移、远程转本地功能捆绑交付。

### 1.3 当前生效的远程浏览契约

本节取代 G0/G3 历史阶段中“用户手动翻远端页、搜索只过滤当前远端页”的旧方案，后续会话和 Provider 接入必须以此为准：

1. 打开浏览器、切换远程标签、选择图床均不请求网络；用户明确选择“开始扫描”后才允许列举。
2. 管理前缀和结果页大小在输入时立即更新会话状态，并在 300ms 后持久化，不依赖 `change` 或失焦事件。
3. Provider 仍按协议单页返回；浏览会话自动追踪 opaque cursor，每次最多请求 1000 项，每批最多 10 次请求（约 10000 项）后暂停并提供“继续扫描”。
4. “停止”使当前批次及迟到响应失效；已完成页面的元数据可以保留。刷新从当前前缀的第一页重新扫描。
5. 所有已扫描远端页聚合为一个会话内元数据集合；搜索和排序作用于该集合，而不是分别过滤某个远端页。
6. `RemoteManagementConfig.pageSize` 只表示本地搜索结果每页显示数量，不再控制 S3 `max-keys`。
7. UI 的上一页/下一页只切换本地搜索结果，不发送网络请求；远端尚未扫描完成时通过“继续扫描”继续获取。
8. 范围为空时显示“无对象”，关键词无命中时显示“当前页无匹配”，不得用空表掩盖扫描错误。
9. 列表仍为 metadata-only，不创建远程 `<img>`、预览请求、选择或删除入口。

## 2. 当前实现基线与主要缺口

### 2.1 可复用部分

- `ImageHostingConfig.id`：可作为远程管理配置、缓存和上传记录的稳定关联键。
- `urlPrefix` 与 `uploadPath`：可辅助建立公开 URL 和 object key 的映射关系。
- `requestUrl`：继续作为所有图床 HTTP 请求的统一底层 API。
- `RefConverter.parseReferences()`：可作为标准 Markdown 图片引用解析的基础。
- 图片浏览器现有搜索、排序、缩略图尺寸和本地预览交互：可复用视觉语言与部分 UI 控件。
- 阿里云 OSS 和 S3-compatible 已有签名、路径编码测试：可在保持上传行为不变的前提下抽取公共签名组件。
- 七牛已有 Base64URL、HMAC 和区域配置基础，但管理凭证不能直接等同于现有上传凭证。

### 2.2 必须补齐的缺口

- 现有 `UploaderBase` 只有 `upload()` 与 `testConnection()`，没有列举、预览、删除能力。
- 现有图片浏览器一次创建全部卡片和 `<img src>`，不适用于远程对象。
- 现有 `OrphanFinder` 明确跳过 HTTP/HTTPS 引用，只能判断本地 `TFile`。
- `UploadHistoryEntry` 只在全库批量上传时临时生成，没有持久化；单图、笔记、粘贴上传也没有统一经过该队列。
- `UploadResult` 没有返回稳定的 `objectKey` 和图床配置 ID，无法作为可靠的远程对象记录。
- 当前引用解析无法证明外部网站、其他 Vault 或第三方插件是否使用对象。
- 私有 Bucket 的预览需要临时授权 URL，不同图床算法不同。
- 删除、版本控制、对象锁、归档存储、权限错误的语义因图床而异。

## 3. 公共术语与标准模型

### 3.1 统一类型草案

建议在 `src/remote/` 下建立独立领域模型，不把远程管理方法直接加入 `UploaderBase`：

```typescript
type RemoteCapability = 'list' | 'preview' | 'delete';

type RemoteReferenceState =
    | 'referenced'
    | 'possibly-referenced'
    | 'not-referenced-in-current-vault'
    | 'unmappable';

interface RemoteObject {
    hostingId: string;
    key: string;
    size: number;
    lastModified?: number;
    etag?: string;
    mimeType?: string;
    storageClass?: string;
}

interface RemoteListRequest {
    prefix: string;
    cursor?: string;
    limit: number;
    delimiter?: string;
}

interface RemoteListPage {
    objects: RemoteObject[];
    nextCursor?: string;
    isTruncated: boolean;
}

interface RemoteDeleteResult {
    key: string;
    success: boolean;
    status?: number;
    error?: string;
    deletionKind?: 'permanent' | 'delete-marker' | 'unknown';
}

interface RemoteObjectProvider {
    readonly capabilities: ReadonlySet<RemoteCapability>;
    listObjects(request: RemoteListRequest): Promise<RemoteListPage>;
    createPreviewUrl?(object: RemoteObject): Promise<string>;
    deleteObject?(object: RemoteObject): Promise<RemoteDeleteResult>;
}
```

具体实现时可调整字段，但必须维持以下边界：

- 公共层只处理规范化对象、游标、能力和错误。
- Provider 层负责签名、请求格式、响应解析与服务商语义。
- UI 不解析 provider 原始 XML/JSON。
- 删除结果不能仅用布尔值掩盖 delete marker、永久删除或未知语义。

### 3.2 建议模块结构

```text
src/remote/
├── types.ts                         # 公共远程对象类型
├── provider.ts                      # RemoteObjectProvider 接口
├── provider-factory.ts              # 按 HostingType 创建远程适配器
├── management-settings.ts           # 管理范围与安全设置
├── reference-index.ts               # 当前 Vault 远程引用索引
├── object-reference-matcher.ts       # URL ↔ object key 规范化和匹配
├── scan-session.ts                  # 当前会话分页、取消、过期状态
├── deletion-service.ts              # 删除确认后的队列与结果汇总
└── providers/
    ├── aliyun-oss-remote.ts
    ├── qiniu-remote.ts
    ├── s3-compatible-remote.ts
    └── custom-remote.ts

src/modals/
├── image-browser.ts                 # 外壳或本地入口
├── remote-image-browser.ts          # 远程对象列表/网格
├── remote-image-preview.ts          # 按需远程预览
└── remote-delete-confirm.ts          # 专用删除确认，不复用简单确认框
```

### 3.3 配置模型草案

在每个 `ImageHostingConfig` 下增加可选配置，确保旧数据默认禁用：

```typescript
interface RemoteManagementConfig {
    enabled: boolean;
    prefix: string;
    pageSize: number;
    previewMode: 'manual' | 'viewport';
    deleteEnabled: boolean;
    publicUrlAliases: string[];
}
```

约束：

- 默认 `enabled=false`、`deleteEnabled=false`、`previewMode='manual'`。
- `prefix` 允许为空；空值表示当前图床配置中的整个 Bucket。
- 保存时去除前缀首尾多余 `/`，不修改中间路径，也不从上传路径模板自动推断管理前缀。
- 每个图片浏览器会话首次用空前缀扫描时必须确认；同一会话内翻页不重复确认。
- `pageSize` 按图床配置保存，初始默认 100，Provider 再限制到服务商允许范围。
- `publicUrlAliases` 用于 CDN、自定义域名与源站域名共同映射。
- 凭据继续沿用现有图床配置，不在缓存、日志或错误消息中复制。

## 4. 公共功能阶段

所有图床轨道都依赖公共阶段。Provider 可以在公共基础完成后独立推进，不要求彼此同步。

### G0：需求冻结、交互草图与测试矩阵

**状态：已完成。**

**阶段目标**

把 Issue 的自然语言需求转成可以测试的产品契约，避免边开发边改变“孤立”含义。

**实施内容**

1. 冻结 S3-first 产品范围，首批兼容与人工验收目标为 Cloudflare R2 和 MinIO。
2. 确认本地/远程切换、图床选择、范围提示、分页、引用状态、按需预览、删除确认的低保真交互。
3. 冻结四种引用状态及用户可见文案。
4. 确认目录前缀可为空；空值表示当前配置 Bucket 的根范围，并在会话首次扫描前确认。
5. 建立脱敏测试对象矩阵与 R2/MinIO 专项矩阵。
6. 远程引用管理只统计 Markdown 中的标准图片引用与受管 URL 原始文本命中；非 Markdown 文件不属于本项目的引用判断范围。

#### G0.1 首版交互文字线框

远程管理复用现有图片浏览器 Modal 外壳，在同一 Modal 内切换本地与远程视图；远程视图拆为独立组件，避免继续扩大现有本地图片渲染逻辑。

```text
┌────────────────────────────────────────────────────────────┐
│ 图片浏览器                           [本地图片] [图床图片] │
├────────────────────────────────────────────────────────────┤
│ 图床：[S3 配置 ▼]  Bucket：my-bucket                     │
│ 目录前缀：[obsidian/vault-a/________________]              │
│ 范围：my-bucket/obsidian/vault-a/                          │
│ 每页：[100 ▼]                         [开始扫描] [刷新]     │
├────────────────────────────────────────────────────────────┤
│ 当前页仅显示元数据，不自动请求缩略图                       │
│ key │ 大小 │ 修改时间 │ ETag │ 存储类型 │ 引用状态         │
│ ...                                                        │
├────────────────────────────────────────────────────────────┤
│ 已加载当前页 100 项                  [上一页] [下一页]      │
└────────────────────────────────────────────────────────────┘
```

交互契约：

1. 打开图片浏览器、切换到“图床图片”、选择图床或编辑前缀均不发送网络请求。
2. 只有选择“开始扫描”或用户主动翻页、刷新时才允许请求列表 API；一次操作最多读取一页，不自动追完后续分页。
3. 图床、Bucket 或前缀改变时立即废弃旧结果和游标；迟到响应不得覆盖当前选择。
4. `pageSize` 按图床配置保存，默认 100；搜索与排序首版只作用于已加载页并明确标注。
5. 列表首屏只显示元数据，不创建远程 `<img src>`；预览属于 G4，删除属于 G5。

#### G0.2 空前缀文案与确认行为

设置帮助文案：

> 留空将管理当前 Bucket 中的全部对象。Bucket 内容较多时，扫描可能产生更多请求和流量费用，并扩大引用检查与删除范围。建议为当前 Vault 设置专用目录前缀。

每个图片浏览器会话首次用空前缀扫描时显示：

- 标题：`扫描整个 Bucket`
- 正文：`当前未设置目录前缀，本次将分页读取该 Bucket 中的全部对象。对象较多时可能增加请求次数和流量费用；当前 Vault 未检测到引用，也不代表对象可以安全删除。请确认你了解这些影响后继续。`
- 操作：`取消`、`继续扫描`

取消不得发送请求；确认后仍只读取一页。同一会话内翻页不重复提醒；关闭并重新打开图片浏览器后再次提醒。文案不使用“后果自负”等指责性表达，但必须明确费用、范围和误删风险。

#### G0.3 引用状态与首版扫描范围

| 内部状态 | 首版用户文案 | 含义 |
|----------|--------------|------|
| `referenced` | 当前 Vault 已引用 | 标准 Markdown 图片引用可明确映射到该 object key |
| `possibly-referenced` | 当前 Vault 可能引用 | HTML、frontmatter、普通链接或受管 URL 原始文本命中 |
| `not-referenced-in-current-vault` | 当前 Vault 未检测到引用 | 已扫描范围未命中，不代表可安全删除 |
| `unmappable` | 无法匹配引用 | URL 或 object key 无法可靠映射，不按文件名猜测 |

引用索引只扫描 Markdown；UI 明确状态为当前 Vault 的 Markdown 扫描结果。删除能力使用同一范围，不扩张到非 Markdown 文件。

#### G0.4 S3 测试矩阵

| 类别 | 必测场景 | 预期契约 |
|------|----------|----------|
| 范围 | 空前缀、普通前缀、嵌套目录、前后多余 `/` | 空前缀映射 Bucket 根；非空前缀只列举规范化范围 |
| 对象 key | 中文、空格、`#`、`?`、`%`、括号、编码斜杠、空文件、大文件元数据 | 逻辑 key、请求路径和显示值不混淆，不重复解码 |
| 分页 | 空结果、单页、多页、末页、重复/失效 token | cursor 保持不透明；一次操作只读取一页；异常不自动重试遍历 |
| 签名 | path-style、virtual-hosted、端口、endpoint base path、query 排序 | 请求 URL、Canonical URI 和 Canonical Query 完全一致 |
| 错误 | 401、403、404、429、5xx、网络失败、错误 XML | 映射为可理解错误，不泄露凭据、Authorization 或完整签名 URL |
| 会话 | 切换图床/前缀、刷新、关闭 Modal、迟到响应 | 旧游标和结果失效，不更新已关闭或已切换的视图 |
| 流量 | 打开、切换、选择、确认前、扫描、翻页 | 前四项请求数为 0；扫描和每次翻页最多一次列表请求 |
| 回归 | 现有 S3 上传、公开 URL、引用替换 | 远程管理不得改变上传行为或 `urlPrefix` 语义 |

Cloudflare R2 专项：

- 标准 account endpoint 与 jurisdiction endpoint。
- `region=auto`，并保留空值/`us-east-1` 兼容行为的测试边界。
- path-style 为首要实际配置；ListObjectsV2 的 `prefix`、`delimiter`、`max-keys`、`continuation-token` 与 `encoding-type`。
- API endpoint、公开 `r2.dev`/自定义域名和 `urlPrefix` 分别建模，不相互推断。

MinIO 专项：

- path-style 为首要实际配置，同时覆盖 virtual-hosted 能力状态。
- HTTP/HTTPS、自定义端口、反向代理 base path 与自签名/网络失败提示。
- ListObjectsV2 多页、特殊字符 token、标准 S3 错误与 MinIO 特有错误。
- 人工验收记录 MinIO 版本、部署入口、URL style 和测试日期，不把其他 S3-compatible 服务自动标记为已验证。

**阶段验收标准**

- 有可审阅的交互草图或文字线框，不存在“打开远程标签是否立即请求”的歧义。
- 测试矩阵完整覆盖 S3 公共边界、Cloudflare R2 和 MinIO；其他图床不阻塞 G0 与 S3 首版。
- “未检测到引用”与“可安全删除”在所有文案中明确分离。
- 空前缀合法且表示当前 Bucket 根；会话首次扫描前确认，确认后也不自动追完全部分页。
- 文字线框明确打开、切换、选择和确认前均不请求网络，预览和删除不属于 list-only 首版。
- `pageSize` 冻结为 per-hosting、默认 100；远程引用索引范围冻结为 Markdown。
- 将最终决策写入本文“决策记录”。

### G1：远程对象公共接口与测试底座

**状态：已完成。**

**阶段目标**

建立 Provider 无关的类型、工厂、错误模型和网络测试方法，不改变现有上传行为。

**实施内容**

1. 新增 `src/remote/` 公共类型与 `RemoteObjectProvider`。
2. 新增 `RemoteProviderError`，规范化权限、认证、限流、网络、解析、不支持等错误类别。
3. Provider factory 根据 `ImageHostingConfig.type` 返回适配器或明确的 unsupported 状态。
4. 对 `requestUrl` 建立可 mock 的请求边界，测试禁止输出 Authorization、AK/SK、签名 URL token。
5. 为分页游标定义不透明字符串契约，公共层不得解析或二次编码 provider 游标。
6. 保持现有 `UploaderBase` API 和上传测试完全不变。

**阶段验收标准**

- 公共类型可编译，四种图床均能返回明确能力集合。
- unsupported provider 不抛出未捕获异常，UI 可显示原因。
- Provider 错误不包含密钥、Authorization 或完整临时签名。
- `npm test`、`npm run build` 通过，现有上传测试无回归。
- 新增 factory、错误映射、游标透传单元测试。

### G2：Vault 远程引用索引与对象匹配

**状态：已完成。**

**阶段目标**

建立保守的“当前 Vault 是否检测到引用”判断，作为所有图床的公共能力。

**实施内容**

1. 使用 `RefConverter` 解析标准 Markdown 图片引用。
2. 对 `.md` 内容增加受管 URL 的原始文本扫描，把 HTML、frontmatter、普通链接等命中标记为 `possibly-referenced`。
3. 删除门禁只接受 fresh Markdown 索引；未扫描或 stale 时不得得出未引用结论。
4. URL 规范化仅处理可证明安全的部分：协议/主机大小写、默认端口、fragment、provider 允许忽略的查询参数。
5. 路径按段解码，禁止把编码的 `%2F` 误解成目录分隔符，禁止重复解码 `%2520`。
6. 支持 `urlPrefix` 与多个 `publicUrlAliases` 映射到同一 object key。
7. 对无法映射的 URL 返回 `unmappable`，不以文件名猜测远程对象。
8. 索引结果按 Vault 文件修改事件失效，但首版不后台重新扫描。

**阶段验收标准**

- 中文、空格、保留字符、查询参数、CDN 别名、嵌套前缀测试通过。
- 相同文件名、不同目录的对象不会互相误判。
- 普通 Markdown 图片引用得到 `referenced`；仅原始 URL 命中得到 `possibly-referenced`。
- 外部域名或不匹配任何受管 URL base 的引用不会被错误映射。
- 无法映射时不降级到 basename 猜测。
- 扫描范围和最后扫描时间在 UI 可见。

### G3：远程图片浏览器外壳与元数据分页

**状态：已完成。**

**阶段目标**

提供 Issue 所需的本地/远程切换和手动分页列表，同时保证打开界面不产生远程图片流量。

**实施内容**

1. 在图片浏览器增加“本地 / 图床”数据源切换。
2. 远程模式提供图床选择、管理范围摘要、手动扫描、上一页/下一页、刷新和停止。
3. 只有点击“扫描”后才能调用 `listObjects()`。
4. 空前缀表示当前配置 Bucket 根；每个 Modal 会话首次扫描前显示 G0 冻结的友好确认，取消时不发送请求。
5. 首次渲染仅显示对象 key、大小、修改时间、存储类型和引用状态，不创建远程 `<img src>`。
6. 图床切换、前缀修改或 Modal 关闭时使旧请求结果失效；晚到响应不能覆盖当前图床。
7. 会话内缓存已访问页面的元数据；不持久化签名 URL。
8. 搜索和排序首版只作用于已加载页，UI 明确标注，避免假装是全 Bucket 搜索。
9. Custom 或尚未完成的 Provider 显示能力说明，不显示不可用按钮。

**阶段验收标准**

- 打开图片浏览器、切换到图床标签、选择图床均不发网络请求。
- 一次扫描最多获取配置页大小的数据，不自动追完所有分页。
- 页面不存在任何远程图片请求，网络 mock 只观察到列表 API。
- 快速切换两个图床不会显示前一个图床的迟到结果。
- 空结果、无权限、游标失效、限流和解析失败均有明确提示。
- 本地图片浏览、孤立筛选和预览行为无回归。

**当前证据（2026-07-18）**

- 在共享 G 系列分支新增每图床远程管理配置、`RemoteBrowseSession`、本地/图床切换和独立 metadata-only 远程视图；旧配置默认关闭。
- 生产 registry 尚无真实 list Provider，因此已配置图床显示明确 unsupported 状态，不显示无效扫描按钮；真实 Cloudflare R2/MinIO 列举人工验收留给 S3-1/S3-2。
- 会话使用 generation 隔离迟到响应；停止可取消本地引用扫描并忽略远程迟到响应，但由于公共 Provider 接口未接受取消信号，不承诺中断已发出的 HTTP 请求。
- `npm test` 109/109、`npm run build`、`git diff --check` 通过，作为 G3 自动化与构建证据。
- 2026-07-18：用户完成 Obsidian 基本验收，确认本地浏览器回归、零自动远程请求和 unsupported UI；真实 Provider 列举行为继续由 Issue #23 与 S3 专项验收覆盖。

### G4：按需预览与流量控制

> 当前交付：Issue #26，分支 `feat/issue-26-s3-remote-management`。首版仅实现手动按需预览；viewport 自动预览不在该 Issue 范围。

**阶段目标**

允许用户查看远程图片，但远程内容请求必须由明确操作触发并受到限制。

**实施内容**

1. 默认 `manual`：对象行只提供操作按钮，点击后才在独立预览 Modal 生成/请求预览 URL；同一时间只保留一个活动预览。
2. S3 必须明确选择 `presigned | public`；旧配置默认 presigned，公开模式只使用 `urlPrefix`，不得猜测 ACL 或回退。
3. 私有图床只生成 300 秒临时 URL；会话内可复用，但距到期不足 30 秒或用户重试时重新生成，不写入设置、持久缓存或日志。
4. 关闭预览/浏览器、切换图床、修改前缀或刷新扫描时清除 URL 缓存并作废迟到结果；图片元素使用 `no-referrer`。
5. 对失败预览显示占位符和重试按钮，不自动无限重试；列表、搜索、排序和本地分页保持可用。
6. 显示本次会话实际设置远程 `<img src>` 的次数，失败与人工重试分别计数；首版不统计下载字节。
7. 非支持图片类型与已知归档存储类型不请求；Provider 图片处理参数不作为基础预览依赖。
8. `viewport`、列表缩略图和后台预加载继续延期，不进入 Issue #26 当前预览交付。

**阶段验收标准**

- 元数据页初始渲染远程图片请求数为 0。
- 点击一个对象只请求该对象；连续点击受并发限制。
- 私有预览 URL 到期后可重新生成，旧 URL 不持久保存。
- Modal 关闭后不存在继续加载或 DOM 更新。
- 预览失败不影响列表、分页和其他对象。
- 公共与私有测试 Bucket 均完成人工验收。

### G5：删除安全框架

> 当前交付：Issue #26，分支 `feat/issue-26-s3-remote-management`。删除默认关闭，且 fresh Markdown 引用索引是开放删除前的硬门槛。

**阶段目标**

提供统一但保守的远程删除流程，Provider 只负责执行服务商请求。

**实施内容**

1. 删除功能默认关闭，按图床配置单独启用。
2. 任何引用状态都不默认勾选；`referenced` 和 `possibly-referenced` 默认禁止批量选择。
3. 专用确认页展示图床、Bucket、前缀、完整 key、大小、引用状态、扫描时间和删除语义说明。
4. 首版批量上限建议 20，串行或低并发执行；不进行无上限自动重试。
5. 快照过旧时要求刷新或明确确认；删除后使相关列表缓存失效。
6. 每个对象保留独立成功/失败结果，失败对象不得从 UI 消失。
7. Provider 必须报告“永久删除 / delete marker / 未知”，不能统一显示成“已永久删除”。
8. 保存不含密钥的本地删除记录：时间、hostingId、key、结果和状态码；记录容量需有限制。

**阶段验收标准**

- 未启用删除时，代码路径不会发送删除请求。
- 用户必须经过范围确认和最终确认才能执行。
- 批量上限不可由 UI 绕过，部分失败可准确重试选定项。
- 删除请求使用列表返回的完整 key，不通过文件名重建。
- 401/403/404/409/412/423/429/5xx 等错误不会被报告为成功。
- 删除后重新列举可反映服务商实际结果；版本控制场景文案正确。
- 删除测试只使用专用测试 Bucket/前缀，不使用真实用户数据。

### G6：统一上传结果与持久化上传清单

**阶段目标**

补全插件自己上传对象的可追踪性，作为远程对象的附加可信信号，而不是列表 API 的替代品。

**实施内容**

1. 扩展 `UploadResult` 返回 `objectKey`，并保留兼容字段。
2. 建立统一 `UploadService`，让单图、笔记、全库批量、粘贴自动上传都经过相同成功回调。
3. 持久化 schema-versioned 上传清单：hostingId、objectKey、URL、源路径、大小、哈希、时间。
4. 限制记录数量或提供压缩/清理策略，避免插件数据无限增长。
5. 图床配置被删除时保留历史记录但标记配置缺失，不自动把记录迁移到同名配置。
6. 远程列表可显示“由本插件记录上传”，但仍独立计算当前 Vault 引用状态。

**阶段验收标准**

- 四条上传路径都产生结构一致的记录。
- 上传失败、重试中、URL 缺失时不写成功记录。
- 配置重命名不破坏 hostingId 关联；配置删除不误关联新配置。
- 旧设置数据可以无损加载，迁移有自动化测试。
- 上传记录不能让未列举到的对象获得“远程存在”结论。
- 全部既有上传、替换引用和自动清理测试通过。

### G7：跨图床整合、文档与发布门禁

**阶段目标**

让不同成熟度的 Provider 可以安全共存，并形成可发布、可维护的功能。

**实施内容**

1. UI 按 capability 显示 list-only、preview、delete、unsupported。
2. README/README_ZH 说明流量、请求费用、独立 Bucket/前缀、私有预览和删除风险。
3. 为每个 Provider 提供最小权限说明，但不声称可以无副作用检测删除权限。
4. 更新 canonical skill 的架构、类型、设置、Modal、Uploader/Remote Provider 文档。
5. 建立人工兼容性矩阵，记录实际测试版本和日期。
6. 选择性发布已经验收的 Provider，不等待其他 Provider；未完成能力保持隐藏或实验状态。

**阶段验收标准**

- 每个公开能力都有自动化测试和对应人工测试证据。
- 中英文文案、README、skill references 与实际行为一致。
- `npm test`、`npm run build`、`git diff --check` 全部通过。
- 真实 Obsidian 中完成本地回归和至少一个公开、一个私有远程范围测试。
- 发布说明明确列出已支持 Provider/能力，不笼统声称“支持所有图床管理”。

## 5. 阿里云 OSS 专项阶段

阿里云轨道依赖 G1；UI 接入依赖 G3；预览与删除分别依赖 G4、G5。各阶段不代表它相对其他图床的优先级。

### OSS-1：抽取 OSS V4 请求签名与 ListObjectsV2

**阶段目标**

在不改变现有 PUT 上传签名的前提下，支持带查询参数的 V4 签名和分页列举。

**实施内容**

1. 从 `aliyun-oss.ts` 抽取可复用 V4 signer，统一 canonical URI、canonical query、headers 和 credential scope。
2. 实现 `GET /?list-type=2`，支持 `prefix`、`delimiter`、`max-keys`、`continuation-token`、`encoding-type=url`。
3. XML 响应解析为 `RemoteObject` 与不透明的 `NextContinuationToken`。
4. 保留逻辑 key 与请求编码 key 的区别，避免 Unicode、空格或 `%` 二次编码。
5. 错误映射覆盖签名失败、时间偏差、无 `oss:ListObjects` 权限、限流与 XML 异常。

**阶段验收标准**

- 现有 OSS 上传签名测试全部通过。
- 单页、空页、多页、CommonPrefixes、归档 storage class fixture 解析正确。
- 中文、空格、保留字符前缀与 continuation token 的 canonical query 测试通过。
- 每次 UI 翻页只调用一次 ListObjectsV2，不请求对象内容。
- 使用专用测试 Bucket 完成至少两页人工验收。

### OSS-2：OSS URL 映射与远程列表接入

**阶段目标**

将 OSS 源站 URL、自定义 `urlPrefix`、CDN alias 与 object key 稳定映射。

**实施内容**

1. 支持默认 virtual-hosted OSS URL 与用户配置的公共 URL base。
2. 支持公共 URL base 包含目录前缀的现有语义。
3. 校验管理前缀与上传路径模板的关系，只提示不自动修改用户模板。
4. 在远程列表展示 OSS storage class、ETag 和 last modified。

**阶段验收标准**

- 默认 OSS 域名、CDN 域名和带目录 `urlPrefix` 映射测试通过。
- URL 查询参数和 fragment 不进入 object key。
- 不在管理前缀内的 URL 不会被判为该范围引用。
- 列表刷新、分页、引用状态在 Obsidian 中人工验收通过。

### OSS-3：OSS 公共与私有按需预览

**阶段目标**

公开 Bucket 使用对象 URL，私有 Bucket 使用短时签名 GET URL，并保持默认不加载。

**实施内容**

1. 增加公开/私有预览配置或自动失败后明确引导，避免静默猜测 ACL。
2. 实现 OSS V4 临时 GET URL，短有效期且不持久化。
3. 可选支持用户已配置的图片处理样式；未配置时不擅自追加处理参数。
4. 保证处理参数参与正确签名，避免签名 URL 生成后再修改 query。

**阶段验收标准**

- 公共预览和私有临时 URL 均只在用户点击后产生。
- 特殊字符 object key 可正常预览。
- 临时 URL 过期后重新生成，日志中没有签名参数。
- 未配置图片处理时不调用额外处理服务。

### OSS-4：OSS DeleteObject

**阶段目标**

支持精确删除单个 OSS object，并正确提示版本控制语义。

**实施内容**

1. 实现签名 `DELETE /{objectKey}` 与 `oss:DeleteObject` 权限错误映射。
2. 对 OSS 返回 204 但对象原本不存在的幂等行为采用“请求已接受”，不声称删除了现存数据。
3. 根据可获得的响应/配置显示永久删除、delete marker 或未知。
4. 批量删除首版仍逐项调用单对象删除；`DeleteMultipleObjects` 另行评估。

**阶段验收标准**

- 精确 key、特殊字符和嵌套目录删除签名测试通过。
- 无版本控制、开启版本控制、无权限、对象不存在测试结果文案正确。
- 删除失败对象保留在结果列表，重新扫描能验证实际状态。
- 人工测试仅使用专用前缀并完成恢复/版本控制说明核对。

### OSS-5：OSS 加固与文档

**阶段目标**

完成费用、权限、归档对象、版本控制和生命周期相关说明。

**阶段验收标准**

- 文档明确 ListObjectsV2 也产生 API 请求费用，预览会产生读取/下行或图片处理费用。
- 文档列出 list、preview、delete 所需能力并建议最小权限。
- 归档/冷归档对象不会被默认尝试预览。
- OSS 轨道兼容性矩阵和测试日期已记录。

## 6. 七牛 Kodo 专项阶段

七牛轨道依赖 G1；现有上传 token 与管理凭证、私有下载凭证必须分开实现和测试。

### QN-1：七牛管理凭证与资源列举

**阶段目标**

支持 `rsf.qiniuapi.com` 资源列举、marker 分页与 JSON 响应规范化。

**实施内容**

1. 按七牛管理凭证规范抽取请求签名，不复用上传 policy token 作为管理 token。
2. 实现 bucket、marker、limit、prefix、delimiter 参数，limit 限制在 1–1000。
3. 映射 `key`、`hash`、`fsize`、`mimeType`、`putTime/lastModify`、`type`、`status`。
4. marker 作为不透明字符串传递，空 marker 表示无下一页。
5. 映射 401、限流、服务端 5xx 和 JSON 结构异常。

**阶段验收标准**

- 空列表、单页、多页、目录前缀和特殊 key fixture 测试通过。
- 管理 Authorization 与上传 token 的测试数据和代码路径明确分离。
- 公开日志不包含 AK/SK、管理 token。
- 专用测试空间完成多页人工验收。

### QN-2：七牛 URL 映射与列表接入

**阶段目标**

使用用户配置域名与 object key 建立引用状态，不依赖已回收的测试域名。

**实施内容**

1. `urlPrefix` 作为主要下载域名，支持额外 CDN/source domain aliases。
2. 处理七牛 key UTF-8 编码、目录分隔符与公开 URL 路径编码。
3. 展示 Kodo hash、MIME、存储类型和状态。
4. 无有效下载域名时允许元数据管理，但禁用预览并说明原因。

**阶段验收标准**

- 多域名指向同一 key 的映射测试通过。
- 没有有效域名时列表功能仍可用，预览按钮明确禁用。
- 私有签名参数 `e`、`token` 不参与 object key。
- 列表和引用状态人工验收通过。

### QN-3：七牛公开与私有按需预览

**阶段目标**

公开空间直接按需访问；私有空间生成短时下载凭证。

**实施内容**

1. 公开空间基于下载域名和 key 构造 URL。
2. 私有空间先构造完整资源/图片处理 URL，再生成 `e` 和 `token`，确保 token 位于最终要求的位置。
3. 图片处理 `imageView2` 或图片样式仅作为用户显式配置的可选优化，并提示处理可能计费。
4. 处理本地时钟偏差和过期错误提示。

**阶段验收标准**

- 公开/私有预览均只在用户操作后请求。
- 私有 URL 过期与时钟偏差有明确错误提示。
- 开启图片处理和不开启两条路径均有测试。
- token、deadline 不持久保存或写入日志。

### QN-4：七牛资源删除

**阶段目标**

使用管理凭证精确调用资源删除接口，并突出七牛删除不可恢复风险。

**实施内容**

1. 构造 `EncodedEntryURI`（bucket + key 的 URL-safe Base64）。
2. 调用 `POST /delete/<EncodedEntryURI>`，处理 200、401、599、612 等结果。
3. 首版逐项删除；七牛 batch API 作为后续性能优化，不改变公共删除确认流程。
4. 删除确认明确说明 Kodo 不提供通用版本恢复能力。

**阶段验收标准**

- 中文、空格、斜杠和保留字符 key 的 EncodedEntryURI 测试通过。
- 612 不存在与真实成功分别记录，不伪造永久删除数量。
- 部分失败结果可独立重试。
- 专用测试空间完成删除人工验收并确认无法恢复文案。

### QN-5：七牛加固与文档

**阶段目标**

完成管理凭证、下载域名、私有空间、图片处理费用和删除不可恢复说明。

**阶段验收标准**

- README 与设置帮助区分上传、管理、私有下载三类凭证用途。
- 无下载域名、测试域名不可用、私有空间、存储状态禁用均有排障说明。
- 七牛轨道兼容性矩阵和测试日期已记录。

## 7. S3-compatible 专项阶段

S3-compatible 是首个开发与发布目标。实现以 AWS S3 API 文档作为协议基准，首批实际兼容与人工验收只面向 Cloudflare R2 和 MinIO；不安排 RustFS 验证，其他服务商只在后续具有实际测试证据时列为已验证。

### 7.1 剩余 S3 统一交付计划

- 跟踪 Issue：[#26](https://github.com/ytahml/obsidian-image-manager/issues/26)，作为 Issue #17 子 Issue。
- 长期分支：`feat/issue-26-s3-remote-management`；从最新 `master` 创建，后续 S3-3、S3-4、S3-5 均在该分支持续提交，直到完整验收后再合并。
- 实施顺序：公共 preview/delete 类型与安全边界 → SigV4 presigned GET → 手动按需预览 UI → Markdown 索引删除门禁 → S3 DeleteObject → R2/MinIO 兼容矩阵与文档收尾。
- presigned GET 默认有效期 300 秒，只存在当前会话；R2 只对 S3 API endpoint 签名，不对自定义域名签名。
- 首版不实现 viewport 自动预览、DeleteObjects、versionId 管理、MFA Delete、Object Lock/retention 绕过、临时凭证/session token。
- 删除默认关闭，只允许 fresh 索引中的 `not-referenced-in-current-vault` 对象；单批最多 20 项、最多 2 并发，204 无法证明永久删除时报告 `unknown`。
- Cloudflare R2、MinIO 的公开/私有预览与专用测试范围删除均通过后，才允许将 S3-3～S3-5 和 Issue #26 标记完成。

### S3-1：抽取通用 SigV4 与 ListObjectsV2

**阶段目标**

在保持现有 PUT 上传正确性的前提下，支持 GET 查询签名和分页列表。

**实施内容**

1. 从 `s3-compatible.ts` 抽取 SigV4 signer，统一 canonical URI、canonical query、headers、payload hash。
2. 同时支持 path-style 与 virtual-hosted-style 的 ListObjectsV2。
3. 实现 `list-type=2`、prefix、delimiter、max-keys、continuation-token、encoding-type=url。
4. XML 解析为统一对象与 cursor，保留 ETag、storage class、last modified。
5. 保持 endpoint 协议、端口、base path 和 `forcePathStyle` 语义。

**阶段验收标准**

- 当前 S3/MinIO 上传路径和签名测试无回归。
- path-style、virtual-hosted、带端口、带 base path 的列表签名测试通过。
- 中文、空格、保留字符和 opaque token 不发生 canonical URI/query 偏差。
- Cloudflare R2 与 MinIO 专用测试 Bucket 均完成至少两页人工验收。

### S3-2：兼容性探测、URL 映射与 UI 接入

**阶段目标**

允许不同 S3-compatible endpoint 以能力状态接入，而不是假设全部实现完全一致。

**实施内容**

1. 使用 `max-keys=1` 的非破坏列表测试检查 ListObjectsV2 能力。
2. `urlPrefix` 继续只表示公开 URL base，不与 API path-style 自动绑定。
3. URL 映射分别覆盖 API endpoint、virtual-hosted 公共 URL、path-style 公共 URL 和 CDN alias。
4. 记录服务商名称/版本、path style、版本控制、对象锁等人工测试信息。

**阶段验收标准**

- 能力测试失败只禁用远程管理，不影响上传。
- `urlPrefix` 行为不因 API path-style 改变。
- Cloudflare R2 与 MinIO 的列表、分页和引用映射均通过。
- 未测试服务商在 UI/文档中显示“兼容性未验证”。

### S3-3：S3 公共与 presigned GET 预览

**阶段目标**

公开对象使用 `urlPrefix`；私有对象使用短时 SigV4 presigned GET。

**实施内容**

1. presigned GET 继承 endpoint、region、path style、base path 和 object key 编码逻辑，只签 `host` 并使用 `UNSIGNED-PAYLOAD`。
2. 固定 300 秒有效期；会话内缓存、距到期不足 30 秒或人工重试时重签，不持久化 URL。
3. 公开模式只使用用户明确配置的 `urlPrefix + encoded key`；缺少 `urlPrefix` 时只禁用预览，不影响列表和上传。
4. 独立预览 Modal 同时只保留一个活动图片；关闭或范围变化清理 URL 并隔离迟到签名/图片事件。
5. 若 endpoint 不支持 presigned GET，保留元数据列表并显示脱敏预览失败，不回退为无签名访问。
6. 不假设 S3-compatible 服务具有统一图片缩略处理能力。

**阶段验收标准**

- Cloudflare R2 与 MinIO 公开/私有预览人工测试通过。
- path-style、virtual-hosted、端口和特殊字符 presign 测试通过。
- 预览失败不会回退为无签名公开访问私有对象。
- 临时 URL 不出现在日志和持久数据中。

### S3-4：S3 DeleteObject

**阶段目标**

精确删除对象，并对版本控制、delete marker、对象锁/MFA/保留策略保持诚实语义。

**实施内容**

1. 实现单对象 `DELETE` SigV4 请求，首版不使用批量 DeleteObjects。
2. 处理 versioning、delete marker、Object Lock、MFA Delete、retention 和权限错误。
3. 如果响应无法判断永久删除，结果标记为 `unknown`，提示重新列举或查看服务端版本。
4. 不为兼容性未知 endpoint 自动重试删除。

**阶段验收标准**

- 无版本、开启版本、无权限、对象锁/保留策略错误测试覆盖。
- 204 只表示请求成功，不统一宣称存储已永久释放。
- Cloudflare R2 与 MinIO 专用范围完成人工删除验证。
- 部分失败、重新扫描和缓存失效行为正确。

### S3-5：S3-compatible 兼容矩阵与文档

**阶段目标**

建立按实际测试结果声明能力的长期维护方式。

**阶段验收标准**

- 至少记录 Cloudflare R2、MinIO 的服务端/产品版本或测试日期、URL style、list/preview/delete 结果。
- 新增兼容服务商必须附测试证据，不能仅凭“支持 S3 API”标记为已验证。
- 文档明确对象锁、版本控制和请求/下行费用由具体服务商决定。

## 8. Custom 图床专项阶段

当前 Custom uploader 只有上传 URL、方法、headers、表单/JSON 映射，没有标准列举与删除协议。Custom 不能自动获得远程管理能力。

### CU-0：能力边界与 unsupported 状态

**阶段目标**

在公共 UI 上正确表达 Custom 默认只支持上传。

**阶段验收标准**

- 未配置远程管理协议时显示“仅上传，不支持对象管理”。
- 不根据 upload URL 猜测 list/delete endpoint。
- 不显示无效扫描、预览或删除按钮。
- 现有 Custom 上传配置和行为无回归。

### CU-1：声明式 JSON 列表适配器

**阶段目标**

为简单 HTTP JSON 图床提供有限、可测试的列表配置，不引入用户脚本。

**实施内容**

1. 可选配置 list URL、GET/POST、静态 headers、query/body 参数映射。
2. 配置 items、key、size、modified、mime、etag、nextCursor 的 JSON path。
3. 配置 prefix、cursor、limit 在请求中的字段名。
4. 首版只支持 JSON；XML、HTML 或动态签名要求编写原生 Provider。
5. 连接测试只取一页少量元数据并展示脱敏预览。

**阶段验收标准**

- 至少两种不同 JSON 结构 fixture 可通过声明式映射解析。
- 缺失字段、非 JSON、无 cursor、错误状态码均有明确错误。
- headers 中的 token 不进入日志、导出示例或错误文本。
- 不存在 `eval`、`Function`、远程脚本下载或执行路径。

### CU-2：Custom 预览映射

**阶段目标**

支持服务端列表直接返回 preview URL，或通过 URL base + key 构造公开预览。

**实施内容**

1. 支持可选 preview URL JSON path。
2. 支持声明式 `urlPrefix + encodedKey`。
3. 不提供任意脚本签名；动态鉴权不支持时明确提示编写原生适配器。
4. 仍遵守 G4 手动/懒加载与并发限制。

**阶段验收标准**

- 直接 preview URL 和 base + key 两种方式通过测试。
- 临时 URL 字段不会被持久缓存。
- 无法鉴权时保持 metadata-only，不尝试无凭据访问。

### CU-3：声明式删除适配器

**阶段目标**

为简单 REST/POST 删除接口提供严格受限的配置能力。

**实施内容**

1. 配置 delete URL template、DELETE/POST 方法、headers、query/body key 字段和成功状态码。
2. object key 只允许作为编码后的模板变量或 JSON/form 字段，不允许字符串脚本。
3. 保存配置前展示完整但脱敏的请求预览。
4. 删除能力必须单独启用，并经过 G5 的公共确认流程。
5. 动态签名、challenge、回调式删除或复杂批量协议改为原生 Provider，不扩张通用配置语言。

**阶段验收标准**

- DELETE path、POST JSON、POST form 三种静态模式测试通过。
- 特殊字符 key 不会越过配置的路径或前缀边界。
- 未声明的响应状态不会被判定成功。
- 不支持的鉴权方式显示明确限制，不允许用户绕过安全边界执行脚本。

### CU-4：原生 Provider 升级路径与文档

**阶段目标**

定义何时停止扩展 Custom 配置并创建正式图床类型。

**阶段验收标准**

- 文档明确 JSON/static HTTP 的支持边界。
- 需要专有签名、XML、多步 token 或服务商语义时，按“新增图床服务商”流程开发原生适配器。
- Custom 能力测试矩阵记录实际验证的 API 示例，不宣称兼容任意图床。

## 9. 跨阶段测试与安全门禁

### 9.1 自动化测试最低要求

- Provider request signer：method、path style、query 排序、payload hash、时间和 header。
- Provider response parser：空页、单页、多页、坏响应、未知字段。
- 分页：opaque cursor、末页、重复游标保护、切换 provider 的迟到响应。
- URL/object key：Unicode、空格、`%`、`#`、`?`、括号、编码斜杠、base path、CDN alias。
- 引用索引：标准图片、HTML/raw URL、query/fragment、同名不同目录、无法映射。
- UI 网络行为：打开/切换不请求，扫描只 list，点击才 preview。
- 删除：默认关闭、批量上限、部分失败、缓存失效、错误映射。
- 设置迁移：旧配置远程管理默认关闭，新增字段往返保存。
- 日志安全：凭据、Authorization、signed URL token 不出现在日志或 snapshot。
- 现有功能回归：本地浏览、孤立检测、四种上传、引用替换、粘贴自动上传。

### 9.2 人工验收最低要求

每个原生 Provider 达到相应能力前，必须在专用测试 Bucket/前缀执行：

1. 空前缀会话确认、单页限制与非空前缀范围隔离。
2. 空列表、单页、多页、特殊字符对象。
3. 公开与私有预览。
4. 权限不足、凭据错误、网络失败。
5. 单对象删除、部分失败、重新列举。
6. 非空前缀与整个 Bucket 范围文案。
7. Obsidian 桌面端；移动端若 Provider 不依赖桌面 API，也应完成至少一次基本测试。

### 9.3 每阶段通用完成条件

任何阶段只有同时满足以下条件才能在进度表中标记完成：

- 阶段验收标准全部有证据。
- `npm test` 通过。
- `npm run build` 通过。
- `git diff --check` 通过。
- 相关 skill reference、README 或 i18n 已更新。
- 没有未解释的凭据、流量或删除安全回归。
- 进度表记录 commit/PR/测试环境；若尚未提交则记录本地变更说明。

## 10. 实施依赖与并行关系

```text
P0 计划文件
  └─ G0 需求与交互冻结
      └─ G1 公共 Provider 接口
          ├─ G2 引用索引与匹配
          ├─ S3-1（首要 Provider；与 G2、G3 可并行）
          ├─ OSS-1 / QN-1 / CU-0~1（S3 首版后按需推进）
          └─ G3 远程浏览器外壳
              ├─ 各 Provider 列表/UI 接入
              └─ G4 预览框架
                  ├─ 各 Provider 预览阶段
                  └─ G5 删除框架
                      ├─ 各 Provider 删除阶段
                      └─ G6 上传清单（可独立推进）
                          └─ G7 整合、文档、发布门禁
```

说明：

- G2 与各 Provider 的列表适配可以并行，但最终 UI 引用状态依赖二者。
- G1 完成后优先启动 S3-1，并以 Cloudflare R2、MinIO 作为首批兼容目标。
- 任一 Provider 完成 list-only 后即可单独发布实验能力，不必等待其他 Provider。
- preview 和 delete 分别依赖公共 G4、G5，不能在单个 Provider 内绕过公共安全框架。
- G6 上传清单不阻塞对象列表，但应在声称“插件管理的远程对象生命周期”前完成。

## 11. 进度总表

状态只允许：`未开始`、`进行中`、`已完成`、`阻塞`。标记完成时必须填写证据。

| ID | 阶段 | 状态 | 依赖 | 完成证据/备注 |
|----|------|------|------|---------------|
| P0 | 创建持续实施计划 | 已完成 | 无 | 本文创建 |
| G0 | 需求冻结、交互草图与测试矩阵 | 已完成 | P0 | 2026-07-16：S3-first 产品契约、文字线框、空前缀确认和 R2/MinIO 测试矩阵；`npm test` 75/75、`npm run build`、`git diff --check` 通过 |
| G1 | 远程对象公共接口与测试底座 | 已完成 | G0 | 2026-07-17：G 系列共用分支 `feat/issue-17-g-series` 本地变更，关联 #19；新增公共类型、factory、错误脱敏、可 mock 请求边界和 opaque cursor 测试；`npm test` 94/94、`npm run build`、`git diff --check` 通过 |
| G2 | Vault 远程引用索引与对象匹配 | 已完成 | G1 | 2026-07-17：新增按需 Markdown 引用索引、受管 URL/object key 保守匹配、URL/query 脱敏与 Markdown 文件事件失效；未扫描/stale 不产生未引用结论；`npm test` 103/103、`npm run build` 通过 |
| G3 | 远程图片浏览器外壳与元数据分页 | 已完成 | G1 | 2026-07-18：远程管理配置、metadata-only 本地/图床切换、会话分页/缓存/迟到响应隔离及 unsupported UI 已实现；`npm test` 109/109、`npm run build`、`git diff --check` 通过，用户已完成 Obsidian 基本验收；真实 Provider 列举由 Issue #23 覆盖 |
| G4 | 按需预览与流量控制 | 已完成 | G3 | Issue #26：手动独立预览 Modal、显式公开/签名访问、短时 URL、会话失效与请求计数已实现；自动化 140/140，Cloudflare R2 与 MinIO 公开/私有预览验收通过；viewport 不在范围 |
| G5 | 删除安全框架 | 未开始 | G2、G3 | Issue #26 同一长期分支承接；下一步完成基于 fresh Markdown 索引的公共删除门禁 |
| G6 | 统一上传结果与持久化上传清单 | 未开始 | G1 | |
| G7 | 跨图床整合、文档与发布门禁 | 未开始 | 已交付 Provider 阶段 | |
| OSS-1 | OSS V4 与 ListObjectsV2 | 未开始 | G1 | |
| OSS-2 | OSS URL 映射与列表接入 | 未开始 | G2、G3、OSS-1 | |
| OSS-3 | OSS 按需预览 | 未开始 | G4、OSS-2 | |
| OSS-4 | OSS DeleteObject | 未开始 | G5、OSS-2 | |
| OSS-5 | OSS 加固与文档 | 未开始 | OSS-3、OSS-4 | |
| QN-1 | 七牛管理凭证与资源列举 | 未开始 | G1 | |
| QN-2 | 七牛 URL 映射与列表接入 | 未开始 | G2、G3、QN-1 | |
| QN-3 | 七牛按需预览 | 未开始 | G4、QN-2 | |
| QN-4 | 七牛资源删除 | 未开始 | G5、QN-2 | |
| QN-5 | 七牛加固与文档 | 未开始 | QN-3、QN-4 | |
| S3-1 | SigV4 与 ListObjectsV2 | 已完成 | G1 | Issue #23：共享 SigV4、ListObjectsV2、XML 解析、1000 项内部批次与游标保护已实现；Cloudflare R2、MinIO 验收通过；`npm test` 130/130、`npm run build`、`git diff --check` 通过 |
| S3-2 | 兼容性探测、URL 映射与 UI | 已完成 | G2、G3、S3-1 | Issue #23：生产 registry、结构化错误、URL bases、自动批次扫描、本地搜索/排序/分页与 metadata-only UI 已验收；开发依赖未进入生产 bundle |
| S3-3 | S3 presigned GET 预览 | 已完成 | G4、S3-2 | Issue #26：公开 `urlPrefix` 与 300 秒 presigned GET、到期重签、独立 Modal 和脱敏失败已实现；自动化 140/140，Cloudflare R2 与 MinIO 公开/私有人工验收通过 |
| S3-4 | S3 DeleteObject | 未开始 | G5、S3-2 | Issue #26，同一长期分支，不另建内部阶段 Issue |
| S3-5 | S3-compatible 兼容矩阵与文档 | 未开始 | S3-3、S3-4 | Issue #26，同一长期分支完成 R2/MinIO 真实验收与收尾 |
| CU-0 | Custom unsupported 能力边界 | 未开始 | G1 | |
| CU-1 | Custom 声明式 JSON 列表 | 未开始 | CU-0、G3 | |
| CU-2 | Custom 预览映射 | 未开始 | G4、CU-1 | |
| CU-3 | Custom 声明式删除 | 未开始 | G5、CU-1 | |
| CU-4 | Custom 原生 Provider 升级路径 | 未开始 | CU-1~3 | |

## 12. 新会话执行协议

后续每个开发会话按以下顺序开始和结束：

### 开始会话

1. 完整读取 `.agents/skills/obsidian-image-manager/SKILL.md`。
2. 完整读取本文和当前阶段关联的 reference 文件。
3. 查看 Issue #17 最新正文、评论、标签和关联 PR，确认外部决策是否变化。
4. 运行 `git status --short --branch`，保护已有用户改动。
5. 从进度表选择一个边界清晰的阶段或该阶段的一个可验收子集。
6. 将阶段标记为“进行中”，在备注中记录本次范围。

### 实施期间

1. Provider-specific 代码不得绕过公共安全与流量控制接口。
2. 不顺带实现下一阶段，除非依赖关系使其不可分割并已记录原因。
3. 优先使用脱敏 fixture 和 mock `requestUrl`；真实删除只操作专用测试范围。
4. 发现计划假设错误时，先更新本文“决策记录”，再改变实现方向。

### 结束会话

1. 对照阶段验收标准逐项核对。
2. 运行 `npm test`、`npm run build`、`git diff --check`。
3. 更新相关 canonical skill references。
4. 在进度表填写 commit/PR、测试命令、人工测试环境和未完成项。
5. 只有验收标准全部满足才标记“已完成”；否则保持“进行中”。
6. 在“变更记录”追加日期、阶段和重要决策，方便下一会话继续。

## 13. 待决策问题

### 13.1 G0 已决策

1. 远程浏览器复用单个 Modal 外壳，在其中切换本地/远程；远程视图使用独立组件。
2. 远程引用管理只覆盖 Markdown；删除判断不扫描或推断非 Markdown 文件。
3. `pageSize` 按图床配置保存，默认 100。
4. 空前缀表示当前配置 Bucket 根，每个 Modal 会话首次扫描前确认；关闭后重新打开需再次确认。
5. S3-compatible 首批实际兼容目标为 Cloudflare R2、MinIO，不安排 RustFS 验证。

### 13.2 后续阶段待决策

1. 删除记录存放在插件 data 还是独立 JSON 文件？G5 根据容量和隐私评估。
2. Custom 声明式配置的 JSON path 是否复用现有简单点路径，还是设计受限 path 语法？CU-1 决定。
3. 图片处理缩略图参数是否进入各 Provider 首个 preview 版本？默认不阻塞基础预览。

## 14. 决策记录

| 日期 | 决策 | 原因 | 影响阶段 |
|------|------|------|----------|
| 2026-07-15 | 初始不预设图床开发优先级（已由 2026-07-16 S3-first 决策取代） | 当时尚未获得实际用户场景 | 全部 Provider |
| 2026-07-15 | 远程管理使用独立 Provider 层，不扩张 `UploaderBase` | list/preview/delete 与 upload 能力及权限不同 | G1、全部 Provider |
| 2026-07-15 | 初始要求共享 Bucket 使用非空前缀（已由 2026-07-16 空前缀决策取代） | 当时采用硬限制控制误扫范围 | G0、G3、G5 |
| 2026-07-15 | 默认 metadata-only、手动分页、手动预览（手动分页已由 2026-07-18 自动批次扫描决策取代） | 避免打开浏览器即产生大量远程流量 | G3、G4 |
| 2026-07-15 | “当前 Vault 未检测到引用”不等于“可安全删除” | 插件无法证明外部系统未引用 | G2、G5 |
| 2026-07-15 | Custom 仅支持声明式静态 HTTP，不支持用户脚本 | 遵守零远程代码与安全边界 | CU-0~4 |
| 2026-07-16 | S3-compatible 改为第一优先级，首批验证 Cloudflare R2 与 MinIO；不安排 RustFS | Issue 用户实际使用 S3-compatible，并明确首批兼容目标 | G0、G1、S3-1~5、G7 |
| 2026-07-16 | 目录前缀允许为空，空值表示当前配置 Bucket 根 | 允许直接管理整个 Bucket，同时通过手动分页和会话确认控制费用与范围风险 | G0、G3、G5 |
| 2026-07-16 | 空前缀使用友好风险提示，不使用“后果自负”等指责性措辞 | 清楚说明请求费用、扫描范围和引用误判风险，同时保持用户体验 | G0、G3、i18n |
| 2026-07-16 | 远程浏览器复用 Modal 外壳，远程视图独立；pageSize per-hosting 默认 100（其语义已改为本地结果页大小） | 控制现有本地浏览器改动范围，并保持不同图床的结果展示偏好 | G0、G3 |
| 2026-07-16 | 初始考虑在删除前扩展非 Markdown 引用扫描（已由 2026-07-18 Markdown-only 决策取代） | 当时希望扩大 Vault 引用覆盖范围 | G0、G2、G5 |
| 2026-07-17 | 远程 Provider factory 使用可注册 builder 与显式 `ready` / `unsupported` 结果 | 让各 Provider 按阶段接入，同时避免 UI 用未捕获异常判断能力 | G1、全部 Provider |
| 2026-07-17 | Issue #17 按阶段系列共用开发分支，G1–G7 使用 `feat/issue-17-g-series` | 减少分支与 PR 数量，同时保留 G、S3 等系列边界 | 全部阶段 |
| 2026-07-17 | G2 保持纯 Markdown 索引层，扫描状态 UI 延后至 G3 | 避免在没有远程浏览器视图时提前扩张 Modal | G2、G3、G5 |
| 2026-07-18 | G3 在无真实 Provider 时交付 metadata-only 浏览器外壳和可注入分页会话；unsupported 图床不显示扫描操作 | 保持 UI、安全边界和测试可先行，避免把假列表能力当成 Provider 支持 | G3、S3-1、S3-2 |
| 2026-07-18 | Issue #23 合并交付 S3 SigV4/ListObjectsV2 与浏览器接入；非空管理前缀作为目录范围在请求时追加 `/` | 形成可独立验收的 S3 metadata-only 纵向能力，并避免相邻前缀越界 | S3-1、S3-2 |
| 2026-07-18 | 远端手动分页改为前缀范围自动批次扫描；每次最多 1000 项、每最多 10 次请求暂停，搜索与 `pageSize` 分页改为本地结果操作 | 当前页过滤无法形成完整搜索结果；目录前缀已承担主要流量边界，同时保留继续与停止控制 | G3、S3-2 |
| 2026-07-18 | 剩余 S3 预览、删除和兼容性收尾统一使用 Issue #26 与长期分支 `feat/issue-26-s3-remote-management`，不再拆内部阶段 Issue/分支 | 保持 S3 公共类型、签名、UI、安全门禁和真实验收在同一集成线上持续一致 | G4、G5、S3-3～S3-5 |
| 2026-07-18 | 远程引用管理范围固定为 Markdown，删除门禁以 fresh Markdown 索引为准，不扩张到其他文件格式 | 本项目面向 Markdown 图片管理，并继续通过保守状态与明确确认表达外部引用未知风险 | G2、G5、S3-4 |

## 15. 变更记录

| 日期 | 变更 |
|------|------|
| 2026-07-18 | 完成 Issue #26 手动预览：新增显式 `presigned | public` 设置、300 秒 SigV4 presigned GET、30 秒到期安全窗口、会话缓存/失效、独立预览 Modal、人工重试和请求计数；`npm test` 140/140、`npm run build`、`git diff --check` 通过，Cloudflare R2 与 MinIO 公开/私有人工验收通过。 |
| 2026-07-18 | 完成 Issue #23 合并后修复并通过验收：前缀和结果页大小输入即时生效、防抖保存；远端分页改为自动批次扫描与本地搜索结果分页；修复终页无 cursor 被误判为重复 cursor 的问题；自动化基线 130/130。 |
| 2026-07-18 | 创建 Issue #26 和长期 S3 分支，冻结手动按需预览、300 秒 presigned GET、20 项/2 并发删除上限及 R2/MinIO 收尾计划。 |
| 2026-07-15 | 创建 Issue #17 持续实施计划，覆盖公共阶段与四种图床专项阶段。 |
| 2026-07-16 | 完成 G0 产品契约：冻结 S3-first、R2/MinIO、空前缀确认、交互线框、引用状态与测试矩阵。 |
| 2026-07-17 | 完成 G1：建立独立远程 Provider 公共类型、显式 unsupported factory、脱敏错误模型、可 mock `requestUrl` 边界与 opaque cursor 契约；上传 API 保持不变。 |
| 2026-07-17 | 完成 G2：建立按需 Vault Markdown 远程引用索引、URL/object key 保守匹配、扫描取消/原子发布与 Markdown 文件变更失效；不请求远程服务。 |
| 2026-07-18 | 推进 G3：图片浏览器支持本地/图床切换；图床视图仅展示元数据，手动分页会话缓存已访问页并隔离迟到响应；旧配置默认关闭，未实现 Provider 明确显示 unsupported；等待 Obsidian 手动验收。 |
| 2026-07-18 | 完成 G3 基本人工验收；推进 Issue #23：实现共享 S3 SigV4、ListObjectsV2 Provider、XML 元数据解析、结构化错误、引用 URL bases 和生产浏览器接入；`npm test` 126/126、`npm run build`、`git diff --check` 通过，等待 R2/MinIO 人工验收。 |

## 16. 服务商官方参考

实现前必须重新核对官方文档的当前版本，不只依赖本文摘要：

- 阿里云 OSS ListObjectsV2：<https://help.aliyun.com/en/oss/developer-reference/listobjectsv2>
- 阿里云 OSS DeleteObject：<https://help.aliyun.com/zh/oss/developer-reference/deleteobject/>
- 七牛 Kodo 资源列举：<https://developer.qiniu.com/kodo/api/list>
- 七牛 Kodo 资源删除：<https://developer.qiniu.com/kodo/1257/delete>
- 七牛 Kodo 私有资源下载：<https://developer.qiniu.com/kodo/1656/download-private>
- Amazon S3 ListObjectsV2：<https://docs.aws.amazon.com/AmazonS3/latest/API/API_ListObjectsV2.html>
- Amazon S3 DeleteObject：<https://docs.aws.amazon.com/AmazonS3/latest/API/API_DeleteObject.html>
- Amazon S3 presigned URL：<https://docs.aws.amazon.com/AmazonS3/latest/userguide/using-presigned-url.html>
- Cloudflare R2 S3 API 兼容性：<https://developers.cloudflare.com/r2/api/s3/api/>
- Cloudflare R2 S3 入门与 endpoint：<https://developers.cloudflare.com/r2/get-started/s3/>
- MinIO S3 API 兼容性：<https://docs.min.io/aistor/developers/s3-api-compatibility/>
