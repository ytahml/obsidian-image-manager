# Changelog

## 2.0.0

### 🇺🇸 English

#### Breaking changes

- Requires Obsidian 1.13.0 or later. The settings screen now uses Obsidian's declarative settings API.
- Local image handling is now explicitly split into **managed** and **delegated** modes. Existing automatic-upload and local-copy preferences are migrated safely into both modes; review the selected mode after upgrading.

#### New features

- Added separate managed and delegated paste/drop pipelines, so the plugin's local file lifecycle is isolated from Obsidian or an external attachment manager's lifecycle ([PR #40](https://github.com/ytahml/obsidian-image-manager/pull/40))
- Added a dedicated explicit-upload workflow and reusable upload-reference manager for direct, note, and vault upload commands

#### Improvements

- Clarified mode-specific settings and help text. Delegated mode hides managed-only local paste controls while preserving their values for a later switch back.
- Strengthened delegated handoff validation and lifecycle protection around attachment creation, rename, move, reference replacement, and optional local cleanup.
- Updated the English and Chinese documentation with the new ownership model and its compatibility boundaries.

### 🇨🇳 中文

#### 破坏性变更

- 需要 Obsidian 1.13.0 或更高版本；设置页已迁移至 Obsidian 的声明式设置 API。
- 本地图片处理现在明确分为 **托管（managed）** 和 **委托（delegated）** 两种模式。原有的自动上传与保留本地副本偏好会安全迁移到两种模式；升级后请检查当前选中的模式。

#### 新功能

- 新增独立的 managed/delegated 粘贴与拖放管线，将本插件的本地文件生命周期与 Obsidian 或外部附件管理器的生命周期隔离（[PR #40](https://github.com/ytahml/obsidian-image-manager/pull/40)）
- 新增专用的显式上传工作流与可复用上传引用管理器，服务单图、笔记和全库上传命令

#### 改进

- 明确各模式对应的设置和说明：delegated 模式隐藏仅适用于 managed 的本地粘贴控件，但保留其值以便日后切换回来。
- 加强委托接力在附件创建、重命名、移动、引用替换及可选本地清理过程中的事务校验和生命周期保护。
- 更新中英文文档，说明新的管理权模型及其兼容性边界。

---

## 1.1.2

### 🇺🇸 English

#### New features

- Added an opt-in **delegated** local image-management mode. Obsidian or a compatible attachment-management plugin can own local image creation, naming, moving, and initial reference updates, while this plugin continues the optional automatic image-hosting handoff ([PR #38](https://github.com/ytahml/obsidian-image-manager/pull/38))
- Added transaction-based paste and drag-and-drop handoff that uniquely matches new attachments with their newly inserted references before uploading and replacing only that exact reference
- Added per-note serial writes and bounded upload concurrency so concurrent paste transactions do not race when they update references or evaluate local cleanup

#### Improvements

- Separated managed local-paste compression from upload-payload compression; delegated mode never modifies the attachment manager's local file
- Hardened automatic local cleanup with attachment identity checks, change-protection windows, fresh reference scans before confirmation and execution, and Obsidian's trash
- Coalesced external rename repairs into non-overlapping batches and deferred them while delegated attachments are still indeterminate
- Clarified local-management ownership, automatic-upload behavior, compatible Attachment Management setup, and lifecycle safety boundaries in the README

#### Fixes

- Fixed delegated path resolution for encoded local references and prevented stale upload results from replacing references or deleting local files
- Fixed official TypeScript ESLint warnings in the external rename-repair coordinator by handling repair failures through an explicitly typed async path

### 🇨🇳 中文

#### 新功能

- 新增可选的 **委托（delegated）** 本地图片管理模式：Obsidian 或兼容的附件管理插件负责本地图片创建、命名、移动和初始引用更新，本插件继续承担可选的自动图床接力（[PR #38](https://github.com/ytahml/obsidian-image-manager/pull/38)）
- 新增基于事务的粘贴/拖放接力：只有在新附件与本次新增引用能唯一对应时，才上传并替换该精确引用
- 同一来源笔记的引用写回和本地清理改为串行执行，并限制并发上传，避免多次粘贴事务彼此竞争

#### 改进

- 拆分 managed 本地粘贴压缩与上传载荷压缩；委托模式绝不修改附件管理者创建的本地文件
- 自动本地清理新增附件身份校验、变更保护期、确认前与执行前的 fresh 引用扫描，并统一通过 Obsidian 回收站处理
- 外部重命名修复改为不重叠的批处理；委托附件仍处于状态未定时延后修复
- README 补充本地管理权、自动上传、Attachment Management 兼容配置和生命周期安全边界说明

#### 修复

- 修复编码本地引用在委托模式下的路径解析，并阻止已失效的上传结果替换引用或删除本地文件
- 外部重命名修复协调器改为显式类型安全的异步错误处理，修复 Obsidian 官方检查报告的 TypeScript ESLint 告警

---

## 1.1.1

### 🇺🇸 English

#### New features

- Added native Qiniu Kodo remote object management with folder browsing, public/private previews, reference detection, and guarded deletion ([PR #32](https://github.com/ytahml/obsidian-image-manager/pull/32))
- Added native Aliyun OSS remote object management with ListObjectsV2, folder browsing, public/private previews, storage-class handling, and guarded deletion ([PR #33](https://github.com/ytahml/obsidian-image-manager/pull/33))
- Added local reference-status filtering, guarded orphan cleanup through Obsidian's trash, expanded reference locations, and clearer remote object paths in the image browser ([PR #35](https://github.com/ytahml/obsidian-image-manager/pull/35))
- Added custom upload reference templates with filename, alt text, extension, and intrinsic-dimension variables plus safe Markdown fallback

#### Improvements

- Unified direct, note, vault batch, and paste uploads through one upload service with structured results, retry tracking, and stable object keys for native providers
- Improved note-image uploads to read unsaved active-editor content, resolve encoded and non-ASCII local paths through Obsidian link semantics, and report safe failure summaries
- Updated the English and Chinese README files with current local/remote browser behavior, provider capabilities, remote-management safety guidance, and new screenshots
- Consolidated the project knowledge base into one canonical skill and five current-fact references, and reorganized adjacent tests while preserving high-risk provider and deletion coverage

#### Fixes

- Fixed Qiniu management request signatures by preserving the required trailing newlines
- Fixed Obsidian official-review warnings and retained compatibility with the project's ES2017 TypeScript target
- Removed an unused internal remote-result pagination helper after the browser moved to complete-result filtering and progressive card rendering


### 🇨🇳 中文

#### 新功能

- 新增七牛 Kodo 原生远程对象管理，支持目录浏览、公开/私有预览、引用检测和受安全门禁保护的删除（[PR #32](https://github.com/ytahml/obsidian-image-manager/pull/32)）
- 新增阿里云 OSS 原生远程对象管理，支持 ListObjectsV2、目录浏览、公开/私有预览、存储类型处理和受安全门禁保护的删除（[PR #33](https://github.com/ytahml/obsidian-image-manager/pull/33)）
- 图片浏览器新增本地引用状态筛选、通过 Obsidian 回收站执行的孤立图片安全清理、展开的引用位置，以及更清晰的远程对象路径（[PR #35](https://github.com/ytahml/obsidian-image-manager/pull/35)）
- 新增上传后自定义引用模板，支持文件名、替代文本、扩展名和图片固有尺寸变量，并在模板无效时安全回退到标准 Markdown

#### 改进

- 使用统一上传服务编排单图、笔记、全库批量和粘贴上传，提供结构化结果、重试次数和原生 Provider 稳定对象 key
- 笔记图片上传改为读取活动编辑器中尚未保存的内容，通过 Obsidian 链接语义解析编码及非 ASCII 本地路径，并提供安全的失败摘要
- 更新中英文 README，补充当前本地/远程图片浏览器行为、Provider 能力、远程管理安全说明和新截图
- 将项目知识库整理为一个 canonical skill 与五份当前事实 reference，并在保留高风险 Provider 和删除覆盖的前提下重组相邻测试

#### 修复

- 修复七牛管理请求签名未保留协议所需尾部换行的问题
- 修复 Obsidian 官方审查警告，并保持与项目 ES2017 TypeScript 目标的兼容
- 图片浏览器改用完整结果筛选与渐进卡片渲染后，移除未使用的内部远程结果分页 helper

---

## 1.1.0

### 🇺🇸 English

#### New features

- Added remote image browser with responsive card grid, viewport-based thumbnail loading, search, sort, and reference-status filters ([PR #27](https://github.com/ytahml/obsidian-image-manager/pull/27))
- Added S3-compatible remote object listing with paged `ListObjectsV2` and virtual folder picker ([PR #24](https://github.com/ytahml/obsidian-image-manager/pull/24))
- Added remote management settings with per-provider enable toggle and S3-only production gating ([PR #22](https://github.com/ytahml/obsidian-image-manager/pull/22))
- Added safe remote deletion with Markdown reference gating, exact-count confirmation, 20-item/2-concurrency scheduling, and a 200-entry redacted local audit trail ([PR #27](https://github.com/ytahml/obsidian-image-manager/pull/27))
- Added remote image preview with public-URL and pre-signed-URL support, including Cloudflare R2 and MinIO ([PR #27](https://github.com/ytahml/obsidian-image-manager/pull/27))
- Added hosting config enable/disable toggle in the settings panel ([PR #29](https://github.com/ytahml/obsidian-image-manager/pull/29))

#### Improvements

- Expanded Markdown reference detection to cover `![]()`, `![[]]`, `<img>`, and Obsidian annotation syntax for remote existence checks ([PR #27](https://github.com/ytahml/obsidian-image-manager/pull/27))
- Remote browser scans are explicit (no auto-refresh); thumbnails load with 4-concurrency and cards append in batches of 60 ([PR #27](https://github.com/ytahml/obsidian-image-manager/pull/27))
- Remote management configuration and browser only expose providers with production `list` capability; unsupported providers show a concise notice ([PR #29](https://github.com/ytahml/obsidian-image-manager/pull/29))
- Added remote scan and search pagination fixes ([PR #25](https://github.com/ytahml/obsidian-image-manager/pull/25))
- Updated documentation, design specs, and canonical skill for remote management ([PR #27](https://github.com/ytahml/obsidian-image-manager/pull/27))


### 🇨🇳 中文

#### 新功能

- 新增远程图片浏览器，支持响应式卡片视图、可视区域懒加载缩略图、搜索、排序和引用状态筛选（[PR #27](https://github.com/ytahml/obsidian-image-manager/pull/27)）
- 新增 S3 兼容远程对象列举，支持分页 `ListObjectsV2` 和虚拟目录选择器（[PR #24](https://github.com/ytahml/obsidian-image-manager/pull/24)）
- 新增远程管理设置，支持按图床启用开关，并限制仅 S3 兼容存储可使用生产列举能力（[PR #22](https://github.com/ytahml/obsidian-image-manager/pull/22)）
- 新增安全远程删除，包含 Markdown 引用门禁、精确数量确认、20 条/2 并发调度和 200 条脱敏本地审计记录（[PR #27](https://github.com/ytahml/obsidian-image-manager/pull/27)）
- 新增远程图片预览，支持公开 URL 和预签名 URL，兼容 Cloudflare R2 和 MinIO（[PR #27](https://github.com/ytahml/obsidian-image-manager/pull/27)）
- 图床配置面板新增启用/禁用开关（[PR #29](https://github.com/ytahml/obsidian-image-manager/pull/29)）

#### 改进

- 扩展 Markdown 引用识别，覆盖 `![]()`、`![[]]`、`<img>` 和 Obsidian 标注语法，用于远程存在性检查（[PR #27](https://github.com/ytahml/obsidian-image-manager/pull/27)）
- 远程浏览器扫描为显式触发（不自动刷新）；缩略图 4 并发加载，卡片按 60 条批量追加（[PR #27](https://github.com/ytahml/obsidian-image-manager/pull/27)）
- 远程管理配置和浏览器仅展示具备生产 `list` 能力的图床；不支持的图床显示简洁提示（[PR #29](https://github.com/ytahml/obsidian-image-manager/pull/29)）
- 修复远程扫描与搜索分页问题（[PR #25](https://github.com/ytahml/obsidian-image-manager/pull/25)）
- 更新远程管理相关文档、设计规范和 canonical skill（[PR #27](https://github.com/ytahml/obsidian-image-manager/pull/27)）

---

## 1.0.9

### 🇺🇸 English

#### New features

- Added `{noteName}` for image filename templates
- Added `{sourceDir}` for preserving the source image's Vault-relative directory in upload path templates ([PR #9](https://github.com/ytahml/obsidian-image-manager/pull/9))
- Added Aliyun OSS Signature V4 support with HMAC-SHA256 signing ([PR #15](https://github.com/ytahml/obsidian-image-manager/pull/15))

#### Improvements

- Unified upload path template resolution for Aliyun OSS, Qiniu, and S3: provider template, then global template, then the default template ([PR #9](https://github.com/ytahml/obsidian-image-manager/pull/9))
- Expanded the public access URL base to support scheme normalization and bucket or directory prefixes; Qiniu now requires this setting ([PR #15](https://github.com/ytahml/obsidian-image-manager/pull/15))
- Improved public image URL generation for Unicode paths, reserved characters, and nested directory prefixes ([PR #15](https://github.com/ytahml/obsidian-image-manager/pull/15))
- Hid upload path and public URL settings that do not apply to custom HTTP uploaders ([PR #15](https://github.com/ytahml/obsidian-image-manager/pull/15))
- Automatically remove the exact direct attachment folder after auto-upload when local copies are disabled and the folder is empty
- Added Vitest coverage for reference conversion, upload paths, hosting providers, image naming, and cleanup, and integrated tests into CI

#### Fixes

- Fixed S3-compatible and MinIO path-style URL construction and SigV4 canonical path encoding ([PR #7](https://github.com/ytahml/obsidian-image-manager/pull/7))
- Fixed Aliyun OSS request path encoding so uploaded object paths match their signatures ([PR #11](https://github.com/ytahml/obsidian-image-manager/pull/11))
- Fixed Qiniu upload tokens and public URLs for Unicode and special-character object paths ([PR #15](https://github.com/ytahml/obsidian-image-manager/pull/15))
- Fixed local Markdown image paths containing spaces, reserved characters, or invalid percent escapes across paste, preview, conversion, reorganization, and batch rename flows ([PR #15](https://github.com/ytahml/obsidian-image-manager/pull/15))
- Prevented upload replacement from rewriting remote image URLs or updating the current note twice after automatic uploads


### 🇨🇳 中文

#### 新功能

- 图片文件名模板新增 `{noteName}` 变量
- 上传路径模板新增 `{sourceDir}` 变量，用于保留源图片在 Vault 中的相对目录（[PR #9](https://github.com/ytahml/obsidian-image-manager/pull/9)）
- 阿里云 OSS 新增基于 HMAC-SHA256 的 V4 签名支持（[PR #15](https://github.com/ytahml/obsidian-image-manager/pull/15)）

#### 改进

- 统一阿里云 OSS、七牛云和 S3 的上传路径模板解析优先级：图床专属模板、全局模板、默认模板（[PR #9](https://github.com/ytahml/obsidian-image-manager/pull/9)）
- 扩展公共访问 URL 基础路径，支持自动补全协议及保留 bucket 或目录前缀；七牛云现在必须配置此项（[PR #15](https://github.com/ytahml/obsidian-image-manager/pull/15)）
- 改进公共图片 URL 生成，正确处理 Unicode 路径、保留字符和多级目录前缀（[PR #15](https://github.com/ytahml/obsidian-image-manager/pull/15)）
- 自定义 HTTP 图床不再显示不适用的上传路径和公共 URL 设置（[PR #15](https://github.com/ytahml/obsidian-image-manager/pull/15)）
- 关闭保留本地副本时，自动上传完成后安全清理对应的空直属附件目录
- 新增引用转换、上传路径、图床、图片命名和目录清理的 Vitest 测试，并将测试接入 CI

#### 修复

- 修复 S3 兼容存储和 MinIO 的路径样式 URL 构建及 SigV4 规范路径编码（[PR #7](https://github.com/ytahml/obsidian-image-manager/pull/7)）
- 修复阿里云 OSS 请求路径编码，确保上传对象路径与签名一致（[PR #11](https://github.com/ytahml/obsidian-image-manager/pull/11)）
- 修复七牛云上传令牌和公共 URL 无法正确处理 Unicode 及特殊字符对象路径的问题（[PR #15](https://github.com/ytahml/obsidian-image-manager/pull/15)）
- 修复粘贴、预览、引用转换、图片整理和批量重命名流程中，本地 Markdown 图片路径的空格、保留字符及无效百分号编码问题（[PR #15](https://github.com/ytahml/obsidian-image-manager/pull/15)）
- 修复上传替换错误改写远程图片 URL，以及自动上传后重复更新当前笔记的问题

---

## 1.0.8

### 🇺🇸 English

#### Fixes

- Fixed reorganize command using vault absolute paths instead of relative paths when `imagePathBase` is set to "note"
- Fixed conflict with Obsidian's "Always update internal links" setting: moving images no longer converts relative paths to invalid absolute paths
- Fixed `fixBrokenImageRefs` using old path instead of new path when restoring directory references after file moves

#### Improvements

- `RefConverter.computeRelativePath` is now public for reuse
- `BatchRename` constructor now accepts settings to support relative path computation
- Added `isReorganizing` flag to prevent `fixBrokenImageRefs` from interfering during reorganize operations


### 🇨🇳 中文

#### 修复

- 修复整理图片命令在 `imagePathBase` 为 "note" 时使用 vault 绝对路径而非相对路径的问题
- 修复与 Obsidian "始终更新内部链接" 设置的冲突：移动图片不再将相对路径转为无效的绝对路径
- 修复 `fixBrokenImageRefs` 在文件移动后使用旧路径而非新路径恢复目录引用

#### 改进

- `RefConverter.computeRelativePath` 改为 public 以便复用
- `BatchRename` 构造函数接收 settings 以支持相对路径计算
- 添加 `isReorganizing` 标志，防止整理操作期间 `fixBrokenImageRefs` 干扰

---

## 1.0.7

### 🇺🇸 English

#### Fixes

- Fixed image preview reference count: now counts all references instead of unique notes. Previously, an image referenced 5 times in one note showed "1 note(s)"; now correctly shows "5 reference(s) in 1 note(s)"
- Expandable details in image preview: click ▸ to view all reference line numbers per note, click a line number to jump to that position

#### Improvements

- Refactored `settings.ts`: split monolithic `display()` into 6 independent methods (`renderLanguage`, `renderGeneral`, `renderImageNaming`, `renderCompression`, `renderGallery`, `renderImageHosting`)
- Added `refresh()` wrapper to consolidate all `display()` calls, reducing deprecated API warnings from 5 to 1
- Optimized version release workflow: `npm version` now automatically runs build check, updates versions.json (newest first), stages all files, commits, tags, and pushes
- Bumped `minAppVersion` from 1.7.0 to 1.12.0


### 🇨🇳 中文

#### 修复

- 修复图片预览引用计数：现在统计所有引用而非仅笔记数。之前同一篇笔记引用 5 次显示"1 note(s)"，现在正确显示"5 reference(s) in 1 note(s)"
- 图片预览支持展开详情：点击 ▸ 查看每篇笔记的所有引用行号，点击行号可跳转到对应位置

#### 改进

- `settings.ts` 模块化拆分：将单体 `display()` 拆分为 6 个独立方法（`renderLanguage`、`renderGeneral`、`renderImageNaming`、`renderCompression`、`renderGallery`、`renderImageHosting`）
- 新增 `refresh()` 方法封装所有 `display()` 调用，deprecated 警告从 5 处降至 1 处
- 优化版本发布流程：`npm version` 自动执行构建检查、更新 versions.json（新版本置顶）、暂存文件、提交、打 tag、推送
- `minAppVersion` 从 1.7.0 提升至 1.12.0

---

## 1.0.6

### 🇺🇸 English

#### Fixes

- Fixed plugin review errors: API compatibility, sentence-case violations, event handler guards, popout window compatibility
- Bumped `minAppVersion` from 1.4.0 to 1.7.0 (`trashFile` API requires 1.6.6+)

#### Improvements

- Upgraded `eslint-plugin-obsidianmd` to 0.3.0 with full Obsidian official rule set (33 rules)
- Added `window.setTimeout`/`window.clearTimeout` for popout window compatibility
- Added `activeDocument` instead of `document` for popout window compatibility
- Added `evt.defaultPrevented` check and `evt.preventDefault()` in editor-paste/editor-drop handlers
- Moved Qiniu region names to i18n system
- Pinned TypeScript to 5.8.x, CI to Node 22.x only
- Cleaned up project dependencies


### 🇨🇳 中文

#### 修复

- 修复插件审核报错：API 兼容性、sentence-case 违规、事件处理器守卫、popout 窗口兼容性
- `minAppVersion` 从 1.4.0 提升至 1.7.0（`trashFile` API 需要 1.6.6+）

#### 改进

- 升级 `eslint-plugin-obsidianmd` 至 0.3.0，启用完整 Obsidian 官方规则集（33 条规则）
- `setTimeout`/`clearTimeout` 改用 `window.*` 版本，兼容 popout 窗口
- `document` 改用 `activeDocument`，兼容 popout 窗口
- `editor-paste`/`editor-drop` 处理器添加 `evt.defaultPrevented` 检查和 `evt.preventDefault()` 调用
- 七牛云区域名称移入 i18n 系统
- 锁定 TypeScript 5.8.x，CI 仅保留 Node 22.x
- 整理项目依赖版本

---

## 1.0.5

### 🇺🇸 English

#### New features

- Added rename button in image browser preview

#### Improvements

- Rename dialog now shows only the filename stem and preserves the extension automatically
- Default settings adjusted: auto-replace after upload and keep local copy are now off by default

#### Fixes

- Fixed rename losing directory path in image references


### 🇨🇳 中文

#### 新功能

- 图片浏览器预览新增重命名按钮

#### 改进

- 重命名弹窗输入框只显示文件名主干，自动保留扩展名
- 调整默认设置：上传后自动替换和保留本地副本默认关闭

#### 修复

- 修复图片重命名引用丢失目录路径问题

---

## 1.0.4

### 🇺🇸 English

#### Improvements

- Added GitHub artifact attestation for release assets (`main.js`, `styles.css`)


### 🇨🇳 中文

#### 改进

- 为发布产物（`main.js`、`styles.css`）添加 GitHub artifact attestation 验证

---

## 1.0.3

### 🇺🇸 English

#### Fixes

- Removed "Obsidian" from plugin description to comply with community guidelines


### 🇨🇳 中文

#### 修复

- 移除插件描述中的 "Obsidian" 以符合社区规范

---

## 1.0.2

### 🇺🇸 English

#### Fixes

- Renamed plugin ID to `md-image-manager` to comply with Obsidian community plugin guidelines


### 🇨🇳 中文

#### 修复

- 将插件 ID 更改为 `md-image-manager`，以符合 Obsidian 社区插件规范

---

## 1.0.1

### 🇺🇸 English

#### Fixes
- Fixed Chinese IME Enter key triggering form submission


### 🇨🇳 中文

#### 修复
- 修复中文输入法回车键触发表单提交的问题

---

## 1.0.0

### 🇺🇸 English

Initial release - A powerful image management plugin for Obsidian.

- Browse and manage images in your vault
- Optimize images (compress, resize)
- Upload to image hosting services (custom API, S3)
- Convert Wiki image references to standard Markdown format

### 🇨🇳 中文

首个版本 - 一款强大的 Obsidian 图片管理插件。

- 浏览和管理库中的图片
- 优化图片（压缩、调整大小）
- 上传到图床服务（自定义 API、S3）
- 将 Wiki 图片引用转换为标准 Markdown 格式
