# Changelog

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
