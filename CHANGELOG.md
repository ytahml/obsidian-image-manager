# Changelog

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
