# 项目架构与业务边界

## 实现导航

| 业务边界 | 源码入口 | 详细契约 |
| --- | --- | --- |
| 生命周期 / 命令 / 文件菜单 | [main.ts](../../../../src/main.ts)、[commands.ts](../../../../src/commands.ts)、[file-menu.ts](../../../../src/file-menu.ts) | [命令范围](../../../../docs/design/command-scopes.md) |
| 受管粘贴 / 委托接力 / 重命名协调 | [lifecycle/](../../../../src/lifecycle) | [本地工作流](local-image-workflows.md) |
| 本地引用 / 压缩 / 回收 / 整理 | [utils/](../../../../src/utils)；`note-content.ts`、`local-image-resolution.ts`、`local-reference-index.ts`、`image-reorganizer.ts` | [本地工作流](local-image-workflows.md) |
| 上传与本地副本策略 | [uploaders/](../../../../src/uploaders)；`UploadService`、`ExplicitUploadWorkflow`、`UploadReferenceManager`、`UploadLocalCleanup` | [上传](hosting-and-remote.md#上传路径与结果)、[范围上传契约](../../../../docs/design/scoped-image-upload.md) |
| 远程对象 / URL 前缀迁移 | [remote/](../../../../src/remote)；provider、session、reference index、delete policy/audit、`UrlPrefixMigration` | [远程管理](hosting-and-remote.md)、[URL 前缀迁移契约](../../../../docs/design/url-prefix-migration.md) |
| 签名协议 | [oss/](../../../../src/oss)、[qiniu/](../../../../src/qiniu)、[s3/](../../../../src/s3) | [服务商协议](hosting-and-remote.md#provider-特有上传协议) |
| 设置 / Modal / UI | [types.ts](../../../../src/types.ts)、[settings.ts](../../../../src/settings.ts)、[modals/](../../../../src/modals)、[i18n/](../../../../src/i18n) | [设置与 UI](settings-and-ui.md) |

边界原则：

- `main.ts` 负责宿主入口和编排；可复用业务及协议逻辑下沉到各自模块。
- `UploaderBase` 负责 upload/testConnection；对象 list/folders/preview/delete 属于独立 `RemoteObjectProvider`。Custom HTTP 没有通用对象管理协议，保持 upload-only。
- UI 通过 provider capability 判断能力，不复制按图床名称判断的分支。
- 请求 URL 与 canonical path/query 使用同一编码来源；签名规则不在 UI 或多个 uploader 中重复实现。

## 命令与兼容边界

注册事实由 `createImageCommands()` 和 [commands.test.ts](../../../../tests/commands.test.ts) 共同核对；宿主接线在 `main.ts`。已发布命令 ID 不随展示文案更名。

| ID | 行为与显示条件 |
| --- | --- |
| `browse-images` | 本地/远程图片浏览器；受 `enableImageBrowser` 门控 |
| `compress-current-image` | 当前受支持图片的原地压缩 |
| `convert-reference-format` | Wiki 图片 → Markdown 范围选择；默认全库，不要求活动笔记 |
| `upload-to-hosting` | 当前受支持图片上传；运行时检查图床配置 |
| `batch-upload` | 全库/文件夹/文章图片上传；默认全库，不要求活动笔记 |
| `find-orphan-images` | 本地孤立图片扫描与确认 |
| `rename-image` | 当前受支持图片重命名并修复引用 |
| `reorganize-images` | 当前 Markdown 笔记的图片整理 |
| `migrate-url-prefix` | 已有远程引用的 URL 基础路径迁移；不移动或上传对象，不要求活动笔记 |

兼容边界：

- `migrate-images` 对应的旧图床迁移引擎与历史 UI 没有实现，仅留兼容类型；它与已实现的 `migrate-url-prefix` 是不同能力。
- 恢复本地引用没有命令或实现，不注册占位入口。
- `convert-reference-format-vault`、`convert-to-md`、`upload-note-images` 已去重移除；旧快捷键需重新绑定统一入口。
- 文件菜单对 Markdown/文件夹使用被点击目标：上传预填范围弹窗，转换直接执行，整理调用相应 note/folder 工作流。[file-menu.test.ts](../../../../tests/file-menu.test.ts) 防止误用活动笔记。

## 生命周期与数据流

`onload()` 加载并规范化设置、初始化业务服务、注册 ribbon/命令/设置页与事件。构造服务不代表开始远程扫描。

```text
paste/drop
  → main.ts 检查 defaultPrevented 并按 localManagementMode 分流
  → managed: ManagedPastePipeline 保存本地图片和引用
  → delegated: ObsidianDelegatedHandoff 观察宿主/外部创建与引用
  → 可选 UploadService 上传
  → 各自事务重验并替换引用
  → fresh 本地引用检查后回收图片，再尝试非递归清理空目录
```

```text
单图 / 笔记范围显式上传
  → ExplicitUploadWorkflow / createUploadPlan
  → UploadService → createUploader
  → UploadReferenceManager 批量快照写回
  → UploadLocalCleanup 按当前模式偏好检查并回收
  → 返回上传、引用更新和回收的独立结果，由 UI 显示
```

```text
用户扫描远程对象
  → RemoteBrowseSession → RemoteObjectProvider
  → RemoteReferenceIndex / object-reference-matcher
  → 内存搜索/排序、viewport 缩略图和预览
  → fresh + scope + snapshot + 确认门禁
  → RemoteDeleteSession → 脱敏 audit → 用户重新扫描核实远端
```

`UrlPrefixMigration` 是独立的本地笔记改写流程：按笔记范围规划 URL 替换，复用 `note-content.ts` 写回；不发服务商请求。保存图床 URL 配置不会隐式执行迁移。

Vault Markdown create/modify/delete/rename 与 editor-change 使远程引用索引 stale。图片 rename 同时通知 delegated、更新生命周期保护并交给 `ExternalRenameRepairCoordinator` 合并处理；整理期间通过 `isReorganizing` 门禁避免重复修复。

## 共享一致性边界

- `note-scope.ts` 统一转换、上传、整理、URL 迁移的笔记范围；范围决定目标笔记，不等于附件目录或全库写回边界。
- `note-content.ts` 提供实时 Editor/Vault 快照和受保护写回；多个 Editor 分歧、内容或绑定变化、文件身份/路径变化时保留用户内容。不得在打开的 Editor 背后直接改已保存文本。
- `local-image-resolution.ts` 统一可写本地引用解析；`LocalReferenceIndex` 是更广义的只读保留/删除判断，不作为格式转换的可写引用列表。
- `UploadReferenceManager` 统一远程引用渲染与普通批量写回；粘贴事务仍保留各自的精确新增引用身份与重验，不强行并入显式上传路径。
- `IndeterminateImageRegistry` 与 delegated 跟踪共同保护尚未稳定的图片；浏览、回收与外部重命名修复必须沿用对应门禁。

## 类型、兼容字段与隐私

类型结构从 [types.ts](../../../../src/types.ts) 和 [remote/types.ts](../../../../src/remote/types.ts) 读取。需要保留的语义：

- 图床 `urlPrefix` 是可包含 bucket/目录的公开 URL base；`uploadPath` 是完整对象 key 模板。Custom 成功结果只有 URL，不由 URL 猜 objectKey。
- 上传成功通知只用于失效相关远程会话；上传记录与删除 audit 都不是远端对象存在性证据。
- `RemoteManagementConfig.pageSize` / `previewMode` 仍为旧 data 兼容字段，当前 UI 采用完整已扫描集合与 viewport 预览；`possibly-referenced` 也是兼容状态，不能据此放宽删除资格。
- 设置由插件 data 持久化；图床凭据随配置保存，不打印完整配置。`remoteDeleteHistory` 只保留有界、脱敏的诊断记录，不参与删除资格或存在性判断。
- 网络能力必须有明确产品用途；不收集 telemetry、不上传 Vault 内容作分析、不获取或执行远程代码。外部文件访问不是插件能力。
