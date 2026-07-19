# 架构概览

## 模块依赖关系

```
main.ts（入口）
├── settings.ts（设置面板）
├── modals/（本地浏览、远程卡片/预览/目录、删除确认/结果及设置 Modal）
├── uploaders/（图床上传）
│   ├── uploader-factory.ts → 4 个上传器
│   ├── upload-path.ts（共享上传路径模板解析）
│   ├── public-url.ts（公共访问 URL 基础路径拼接）
│   └── upload-queue.ts
├── remote/（图床远程对象管理公共层）
│   ├── types.ts（对象、分页、能力与删除结果）
│   ├── provider.ts（与 Provider 无关的能力接口）
│   ├── provider-factory.ts（适配器注册与 unsupported 状态）
│   ├── request.ts（可注入的 `requestUrl` 边界）
│   ├── errors.ts（错误分类与敏感信息脱敏）
│   ├── reference-index.ts（按需 Markdown 远程引用索引）
│   ├── object-reference-matcher.ts（受管 URL 到 object key 的保守匹配）
│   ├── management-settings.ts（每个图床的远程管理默认值与规范化）
│   ├── browse-session.ts（自动批次扫描、游标缓存与迟到响应隔离）
│   ├── preview-session.ts（会话内预览 URL 缓存、到期重签与请求计数）
│   ├── thumbnail-session.ts（可视区域缩略图 URL 的 4 并发队列）
│   ├── delete-policy.ts（fresh Markdown、hosting、前缀和扫描快照门禁）
│   ├── delete-session.ts（20 项选择、2 并发、停止调度和部分失败）
│   ├── delete-audit.ts（最近 200 条脱敏结果与串行持久化）
│   ├── result-page.ts（已扫描元数据的本地搜索与排序）
│   └── providers/s3-compatible-remote.ts（S3 列举/目录/预览/删除、XML 解析、错误映射与引用 URL bases）
├── s3/
│   └── sigv4.ts（上传与远程管理共享的请求目标、canonical query 与 SigV4）
├── utils/（工具模块）
│   ├── ref-converter.ts ← constants.ts（正则）
│   ├── public-url.ts（Markdown URL 的 Unicode 可读化）
│   ├── image-scanner.ts
│   ├── orphan-finder.ts ← ref-converter.ts
│   ├── image-optimizer.ts
│   ├── image-reorganizer.ts ← ref-converter.ts + path-utils.ts
│   ├── batch-rename.ts ← ref-converter.ts
│   └── path-utils.ts
├── types.ts（类型定义）
└── i18n/（国际化）
```

## 核心设计模式

### 1. 工厂模式（上传器）

`createUploader(config)` 根据 `HostingType` 返回对应的 `UploaderBase` 子类实例。新增服务商只需：
- 继承 `UploaderBase`
- 实现 `upload()` + `testConnection()`
- 在工厂中注册

### 2. 策略模式（引用格式）

`ReferenceFormat` 类型（`'markdown' | 'wiki'`）决定引用生成策略。`RefConverter` 负责解析和转换，`reorganizeConvertFormat` 设置控制全局行为。

### 3. 观察者模式（事件处理）

插件通过 `this.registerEvent()` 注册事件监听器，确保 `onunload()` 时自动清理：
- `editor-paste` / `editor-drop`：粘贴/拖放拦截
- `vault rename`：修复 Obsidian 重命名后的引用
- `file-menu`：右键菜单扩展

### 4. 并发队列（上传）

`UploadQueue` 实现 3 并发 worker、3 次重试、进度回调。用于批量上传场景。

### 5. 独立 Provider 边界（远程管理）

`RemoteObjectProvider` 独立于 `UploaderBase`，避免 list/preview/delete 的管理权限扩张既有上传 API。

- `createRemoteObjectProvider()` 通过可注册 builder 创建适配器；未实现的图床返回显式 `unsupported` 结果，不用异常表示 UI 能力状态。
- 图床配置 Modal 和远程浏览器通过同一 Provider capability 判断开放远程管理；只有生产 registry 中具备 `list` 的配置可见。当前仅 S3-compatible 满足条件，阿里云 OSS、七牛和 Custom 保持仅上传。
- `RemoteRequestClient` 封装 Obsidian `requestUrl`，允许 Provider 测试注入脱敏 mock。
- `RemoteProviderError` 只保留分类、HTTP 状态和去掉账号、query、fragment 的 endpoint，不保留上游错误文本或请求头；浏览会话只发布结构化错误码和状态。
- `RemoteListRequest.cursor` 属于 Provider 的不透明字符串，公共层只原样透传。
- `RemoteReferenceIndex` 只在调用方显式扫描时读取 Markdown，完成后由 Vault 文件事件标记为 stale；不会后台自动重扫，非 Markdown 文件不属于远程引用管理范围。
- `RemoteObjectReferenceLookup` 将标准 Markdown 图片、普通链接、HTML、frontmatter、Wiki 包裹和原始 URL 中可可靠映射的地址统一标记为 `referenced`，并保留笔记路径与行号供远程预览跳转；未完成、已失效或存在映射歧义的索引一律不返回“孤立图片”。
- `RemoteBrowseSession` 只在用户明确扫描、继续或刷新时调用 `listObjects()`；扫描内部以 1000 项为请求批次自动追踪 opaque cursor，每最多 10 次请求暂停并等待用户继续。切换范围、停止和关闭视图会作废迟到响应，但当前 Provider 公共接口尚不承诺中断已经发出的 HTTP 请求。
- S3-compatible 已注册首个完整远程管理 Provider：共享 SigV4 层保证上传、列举、预览和删除的请求 URL 与 canonical URI/query 一致；浏览会话聚合 Provider 返回的多页元数据，搜索、排序和引用筛选在完整已扫描集合上执行，不再显示结果页码。
- S3 Provider 额外提供 `folders` 能力：目录选择器使用独立的 `ListObjectsV2(prefix, delimiter='/')` 请求解析 `CommonPrefixes`，按 opaque cursor 加载更多虚拟文件夹；选择结果只更新管理前缀，递归对象扫描仍走原有无 delimiter 流程。
- 远程浏览器初始不请求列表或图片；用户明确扫描后以响应式卡片展示结果。进入可视区域前约 200px 的支持图片自动加载，URL 解析最多 4 并发；首批渲染 60 张卡片，滚动时渐进追加，搜索/排序/引用状态筛选作用于完整扫描集合。私有模式使用 300 秒 presigned GET，公开模式只使用明确配置的 `urlPrefix`；点击缩略图仍打开独立大图 Modal。关闭或范围变化会清空会话 URL 并隔离迟到结果。当前不支持 OSS、七牛和 Custom 的列表能力。
- S3 删除随远程对象管理启用，不增加独立开关；仍只有 fresh Markdown 索引中的 `not-referenced-in-current-vault`、当前 hosting、当前前缀和当前扫描对象可选择，UI 将该状态显示为“孤立图片 / Orphan image”。最终确认要求输入数量并勾选不可撤销确认，每批最多 20 项、最多 2 并发且无自动重试。用户结果统一显示“请求成功”，底层仍保留 `delete-marker | unknown` 供脱敏审计；接受请求后列表/预览/选择失效。
- 每个删除结果完成后通过串行 writer 写入 `ImageManagerSettings.remoteDeleteHistory`，按完成时间倒序最多保留 200 条；只含时间、hostingId、key、状态和稳定结果码，不含 endpoint、URL、凭据或响应正文。该字段严格定位为“本地诊断记录”，当前没有历史 UI，绝不参与远程存在、引用状态或删除资格判断。

## 关键数据流

### 粘贴/拖放 → 保存 → 引用插入

```
ClipboardEvent/DragEvent
  → handleImagePaste/handleImageDrop（返回 boolean）
  → processImageFiles（逐文件处理）
    → generateFileName（命名模板含 {noteName}）
    → ImageNamePromptModal（可选）
    → savePastedImage
      → resolveImagePath（模板变量：{noteName}, {notePath}, {filename}, {year}, {month}, {day}, {timestamp}）
      → ensureDirectory（递归创建）
      → ensureUniquePath（冲突处理：-1, -2, ...）
      → Canvas 压缩（可选，PNG→WebP）
      → vault.createBinary
      → editor.replaceSelection（MD 或 Wiki 格式）
      → autoUploadAfterPaste（可选）
```

### 直接上传 → 复制/替换引用

```
doUpload(file, config)
  → readBinary + 可选压缩
  → createUploader(config, globalTemplate).upload(data, filename, { sourcePath })
  → 成功：clipboard.writeText(ref)
    → 仅在 Markdown 边界还原 URL 路径中的 Unicode，保留敏感 ASCII 编码
  → 可选 replaceReferenceInNote（遍历所有 MD 文件）
```

### 粘贴自动上传 → 替换引用 → 可选本地清理

```
autoUploadAfterPaste(savedFile, data, editor, currentFile)
  → createUploader(config, globalTemplate).upload(data, filename, { sourcePath })
  → 替换当前 Editor 中刚插入的本地引用
  → replaceReferenceInNote（跳过已在内存中更新的当前笔记，只替换其他本地引用）
  → 可选 trashFile（!keepLocalCopy）
  → 直接父附件目录仍为空时永久、非递归删除该目录
```

### 资源整理 → 移动 + 更新引用

```
reorganizeNote(file)
  → ImageReorganizer.reorganizeNote
    → parseReferences（解析所有引用）
    → 逐引用处理（反向遍历）：
      → 跳过：外部 URL、Wiki 引用（可配）
      → resolveImageFromRef（解析图片文件）
      → resolveImagePath（计算目标路径）
      → vault.rename（移动文件）
      → 更新引用格式
    → vault.process（更新笔记内容）
    → updateOtherNotes（更新其他笔记中的引用）
```

## 设置门控逻辑

```
reorganizeConvertFormat
  ├── true（默认）→ 图床功能可用
  │   ├── 图床设置面板正常渲染
  │   ├── 上传命令可执行
  │   └── 粘贴引用使用 MD 格式
  └── false → 图床功能禁用
      ├── 图床设置面板显示提示
      ├── 上传命令 Notice 提示
      └── 粘贴引用使用 Wiki 格式
```

## 模块职责边界

| 模块 | 职责 | 不负责 |
|------|------|--------|
| `main.ts` | 命令注册、事件编排、粘贴/拖放 | 具体业务逻辑（委托给 utils） |
| `settings.ts` | 设置面板 UI 渲染 | 设置值的持久化（main.ts 处理） |
| `ref-converter.ts` | 引用解析、格式转换 | 文件移动、引用替换（reorganizer 处理） |
| `image-reorganizer.ts` | 文件移动 + 引用更新 | 压缩、上传 |
| `batch-rename.ts` | 重命名 + 引用同步 | 文件移动、格式转换 |
| `uploaders/` | 图床上传 | 引用替换（main.ts 处理） |
| `remote/` | 远程对象公共类型、能力、会话、安全策略，以及已接入 Provider 的列表、预览和删除协议 | 上传行为与上传凭据编排（由 `uploaders/` 负责） |
| `image-optimizer.ts` | 压缩、格式转换 | 文件保存（调用者处理） |

## Issue #17 当前交付状态

- S3-compatible 的 G0～G5、S3-1～S3-5 已通过 Cloudflare R2 与 MinIO 人工验收，并由 PR #27 合并到 `master`；Issue #26 已关闭。
- 当前 S3 产品契约包含显式扫描、自动批次列举、虚拟文件夹选择、viewport 缩略图、独立大图预览、Markdown 广义 URL 引用定位和安全删除。
- 2026-07-19 的 S3 优先上线收口已通过用户 Obsidian 验收：远程入口按 production `list` capability 门控，非 S3 保持仅上传，URL alias 使用一行一个的受校验基础路径。
- Issue #17 尚未完成的架构工作是无持久清单的 G6 统一上传 Service、OSS/七牛原生 Provider，以及最终跨图床发布门禁。上传成功只失效远程会话，不能证明对象当前仍存在；这些能力不得被文档描述成已经可用。
