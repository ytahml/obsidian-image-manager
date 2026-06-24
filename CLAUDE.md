# Obsidian Markdown Image Manager — 开发指南

## 项目概述

Obsidian 图片管理插件（ID: `md-image-manager`），TypeScript 编写，使用 Obsidian Plugin API。当前版本 `1.0.8`，`minAppVersion: 1.12.0`。

**核心功能**：图片压缩、图床上传（4 种服务商）、引用格式转换（Wiki ↔ Markdown）、图片浏览器、孤立图片检测、资源整理、批量重命名。

## 开发闭环规则（强制）

**每次开发或修复功能时，必须遵循以下闭环流程：**

### 1. 开发前 — 阅读文档

- 阅读 `.claude/skills/obsidian-image-manager/SKILL.md` 了解项目全貌
- 根据任务类型，阅读 `references/` 下相关模块文档：
  - 新功能：先读 `architecture.md`，再读相关模块
  - Bug 修复：先读 `known-issues.md`，再读相关模块
  - 代码审查：读 `eslint-rules.md` + 相关模块

### 2. 开发中 — 按规范实施

- 遵循 `SKILL.md` 中的编码规范和 ESLint 规则
- 参考 `references/eslint-rules.md` 中的修复模式
- 单文件建议 200-300 行以内（`main.ts` 为例外）

### 3. 开发后 — 更新文档

- 如涉及架构变更：更新 `references/architecture.md`
- 如涉及流程变更：更新相关模块文档
- 如修复已知问题：更新 `references/known-issues.md`
- 如新增功能：更新 `SKILL.md` 的 Reference Index

**文档是代码的一部分，代码变更必须伴随文档更新。**

## 技术约束

- **零外部运行时依赖** — 仅 `obsidian` 包（devDependency）
- 加密用 Web Crypto API（`crypto.subtle`），HTTP 用 Obsidian `requestUrl`
- 剪贴板操作用 `require('electron')`，移动端不兼容
- ESM 源码，esbuild 打包为 CJS `main.js`
- TypeScript strict 模式，锁定 5.8.x
- Node 通过 Volta 固定 22.22.3

## 构建命令

```bash
npm run dev      # watch 模式开发
npm run build    # 生产构建（tsc 检查 + esbuild 压缩）
npm run lint     # ESLint 检查（obsidianmd 官方插件 33 条规则）
```

## 开发工作流程

### Issue 处理流程（强制）

**无论是自己创建还是他人提交的 Issue，必须先打标签再开始开发。**

#### 1. 分析 Issue 类型

根据 Issue 内容判断类型：

| 类型 | 标签 | 说明 |
|------|------|------|
| Bug 报告 | `bug` | 功能异常、崩溃、数据丢失 |
| 新功能 | `enhancement` | 新增功能或功能改进 |
| 文档 | `documentation` | 文档更新或补充 |
| 问题 | `question` | 需要更多信息或确认 |

#### 2. 确认标签

**在打标签前，必须询问用户确认**：

```
根据 Issue 内容，建议标记为 "[标签名]"。
是否确认？
```

#### 3. 应用标签

```bash
gh issue edit <issue-number> --add-label "<label>"
```

#### 4. 开发实现

确认标签后，按以下流程开发：

1. **创建分支**：基于 issue 编号创建分支（如 `fix/issue-1`、`feat/issue-2`）
2. **开发实现**：在分支上进行开发，遵循编码规范
3. **提交代码**：commit message 格式为 `fix: 描述` 或 `feat: 描述`，末尾添加 `Closes #issue编号`
4. **创建 PR**：`gh pr create` 并关联 Issue
5. **合并到 master**：手动合并分支到 master
6. **发布版本**：运行 `npm version patch/minor/major` 自动构建、打 tag、推送

### 分支命名规范

| 类型 | 格式 | 示例 |
| --- | --- | --- |
| Bug 修复 | `fix/issue-N` | `fix/issue-1` |
| 新功能 | `feat/issue-N` | `feat/issue-2` |
| 其他 | `fix/描述` 或 `feat/描述` | `fix/reorganize-paths` |

## CI/CD

### Lint & Build（`.github/workflows/lint.yml`）

- 触发：push/PR 到 `master`
- Node 20.x / 22.x 矩阵
- 执行：`npm ci` → `npm run build` → `npm run lint`

### Release（`.github/workflows/release.yml`）

- 触发：推送 tag（如 `1.0.0`，无 `v` 前缀）
- 执行：`npm ci` → `npm run build` → 打包 zip
- 产物：`main.js`、`manifest.json`、`styles.css`、`md-image-manager.zip`

### 版本发布流程

```bash
npm version patch   # 1.0.7 → 1.0.8
npm version minor   # 1.0.7 → 1.1.0
npm version major   # 1.0.7 → 2.0.0
```

| 阶段 | 脚本 | 动作 |
| ----- | ---- | ---- |
| `preversion` | `npm run build` | 构建检查，失败则中止 |
| `version` | `version-bump.mjs` | 更新 `manifest.json` + `versions.json`（新版本置顶） |
| `version` | `git add` | 暂存 4 个文件 |
| npm 自动 | — | 修改 `package.json`，创建 commit + tag |
| `postversion` | `git push` | 推送触发 GitHub Actions Release |

## 架构

```
src/
├── main.ts              # 入口、12 个命令注册、事件处理、粘贴/拖放编排（~995 行）
├── settings.ts          # 设置面板 UI（6 个 render 方法 + refresh() 封装）
├── types.ts             # 类型定义 + DEFAULT_SETTINGS（17 个设置字段）
├── constants.ts         # 正则（MD_IMAGE_REGEX、WIKI_IMAGE_REGEX）、MIME 映射
├── i18n/                # 国际化（中/英，~180 条翻译，{key} 变量插值）
│   ├── index.ts         # setLocale() + t() 函数
│   ├── en.ts
│   └── zh.ts
├── modals/              # 7 个 Modal 组件
│   ├── image-browser.ts       # 网格浏览、搜索（300ms 防抖）、排序、孤立筛选
│   ├── image-preview-modal.ts # 预览、引用列表（可展开行号）、操作按钮
│   ├── orphan-images.ts       # 孤立图片检测、批量删除
│   ├── rename-image.ts        # 重命名（仅显示主干名）
│   ├── hosting-config.ts      # 图床配置表单（4 种服务商动态字段）
│   ├── confirm-dialog.ts      # 通用确认对话框
│   └── image-name-prompt.ts   # 粘贴/拖放时的命名输入
├── uploaders/           # 4 个上传器 + 工厂 + 并发队列
│   ├── uploader-base.ts       # 抽象基类：upload() + testConnection()
│   ├── uploader-factory.ts    # createUploader() 工厂
│   ├── aliyun-oss.ts          # HMAC-SHA1 签名 PUT
│   ├── qiniu.ts               # 上传 token + 区域端点
│   ├── s3-compatible.ts       # AWS Signature V4
│   ├── custom-uploader.ts     # POST/PUT 可配、JSON path 提取 URL
│   └── upload-queue.ts        # 3 并发、3 重试、进度回调
└── utils/               # 7 个工具模块
    ├── ref-converter.ts       # 引用解析、格式转换、相对路径计算
    ├── image-scanner.ts       # 图片文件扫描、过滤、排序
    ├── orphan-finder.ts       # 孤立图片检测、引用查找
    ├── image-optimizer.ts     # Canvas API 压缩、格式转换
    ├── image-reorganizer.ts   # 资源整理（移动文件 + 更新引用）
    ├── batch-rename.ts        # 重命名 + 全库引用更新
    └── path-utils.ts          # 路径工具（文件名提取、拼接、编码、日期变量）
```

## 核心数据流

### 粘贴/拖放流程

```
editor-paste/editor-drop 事件
  → evt.defaultPrevented 检查
  → handleImagePaste/handleImageDrop（返回 boolean）
  → processImageFiles
    → 可选 ImageNamePromptModal（promptImageName 设置）
    → savePastedImage
      → resolveImagePath（模板变量替换）
      → ensureDirectory（递归创建目录）
      → ensureUniquePath（文件名冲突处理）
      → 可选 Canvas 压缩（autoCompress 设置）
      → vault.createBinary 保存
      → 插入引用（reorganizeConvertFormat 决定 MD/Wiki 格式）
      → 可选 autoUploadAfterPaste（autoUploadOnPaste 设置）
```

### 图床上传流程

```
选择图片 → createUploader() 工厂实例化
  → 可选 autoCompress 压缩
  → uploader.upload(data, filename)
  → 成功后：复制 URL 到剪贴板
  → 可选 replaceReferenceInNote（autoReplaceAfterUpload 设置）
  → 可选 trashFile（!keepLocalCopy 设置）
```

### 资源整理流程

```
reorganizeNote/reorganizeFolder
  → ImageReorganizer.reorganizeNote
    → 解析笔记中所有图片引用
    → 跳过：外部 URL、Wiki 引用（skipWikiRefsOnReorganize）
    → resolveImagePath 计算目标路径
    → vault.rename 移动文件
    → 更新引用格式（convertFormat）
    → updateOtherNotes 更新其他笔记中的引用
```

## 设置门控逻辑

| 设置 | 作用 | 影响范围 |
|------|------|----------|
| `reorganizeConvertFormat` | 使用 MD 标准格式 | 图床功能前置条件、引用格式、整理行为 |
| `skipWikiRefsOnReorganize` | 整理时跳过 Wiki 引用 | 仅影响 reorganize |
| `promptImageName` | 粘贴时提示输入名称 | 粘贴/拖放流程 |
| `autoUploadOnPaste` | 粘贴后自动上传 | 需 `reorganizeConvertFormat=true` |
| `autoReplaceAfterUpload` | 上传后替换引用 | 上传流程 |
| `keepLocalCopy` | 上传后保留本地文件 | 自动上传流程 |

**关键约束**：`reorganizeConvertFormat=false` 时，图床功能完全禁用（设置面板显示提示，命令执行时 Notice 提示）。

## 编码规范

- 单文件建议 200-300 行以内，超长需拆分（`main.ts` 为例外，~995 行）
- 使用 `this.register*` 注册所有监听器，确保卸载时清理
- UI 文本使用 `t('key')` 国际化函数
- 路径处理使用 `path-utils.ts` 中的工具函数
- 图片引用正则在 `constants.ts` 中定义
- 反向遍历处理引用替换（保持字符索引）

## ESLint 配置

使用 `eslint-plugin-obsidianmd@0.3.0`（`obsidianmd.configs.recommended`），含 `typescript-eslint` 的 `recommendedTypeChecked`。

### 关键规则速查

| 规则 | 要点 |
| --- | --- |
| `no-floating-promises` | Promise 必须 `await`/`.catch`/`.then` 或 `void` |
| `no-misused-promises` | 回调不能返回 Promise |
| `no-unsafe-assignment` | 禁止 `any` 赋值，需类型断言 |
| `sentence-case` | UI 文本首字母大写，品牌名保持原样 |
| `no-manual-html-headings` | 用 `new Setting().setHeading()` 代替 `createEl('h3')` |
| `no-static-styles-assignment` | 用 CSS 类代替 `element.style.*` |
| `no-tfile-tfolder-cast` | 用 `instanceof TFile` 代替 `as TFile` |
| `prefer-file-manager-trash-file` | 用 `fileManager.trashFile()` 代替 `vault.delete()` |
| `prefer-window-timers` | 用 `window.setTimeout`/`window.clearTimeout` |
| `prefer-active-doc` | 用 `activeDocument` 代替 `document` |
| `editor-drop-paste` | 检查 `evt.defaultPrevented` + 调用 `evt.preventDefault()` |
| `no-unsupported-api` | 禁止高于 `minAppVersion` 的 API |
| `no-console` | 仅允许 `console.warn`/`error`/`debug` |

### 常见修复模式

```typescript
// 1. 浮动 Promise
void this.handleConfirm();

// 2. 回调返回 Promise
new Modal(app, (saved) => { void save().then(() => display()); });

// 3. JSON.parse 类型安全
this.config = JSON.parse(JSON.stringify(config)) as ImageHostingConfig;

// 4. Array().fill() 类型安全
const ups: string[] = Array.from({ length: count }, () => '..');

// 5. Sentence case
'Access key ID'  // ✅  'Access Key ID'  // ❌

// 6. 设置标题
new Setting(containerEl).setName('标题').setHeading();

// 7. TFile 类型安全
const file = vault.getAbstractFileByPath(path);
if (!(file instanceof TFile)) throw new Error('Not a file');

// 8. window 定时器 + activeDocument（popout 兼容）
window.setTimeout(() => {}, 100);
activeDocument.createElement('canvas');

// 9. editor-paste/editor-drop 处理器
// 处理器返回 boolean，注册处调用 preventDefault
this.registerEvent(this.app.workspace.on('editor-paste', (evt, editor, info) => {
    if (evt.defaultPrevented) return;
    const handled = this.handleImagePaste(evt, editor, info.file);
    if (handled) evt.preventDefault();
}));
```

## 开发完成检查清单

```bash
npm run build    # TypeScript 编译 + esbuild 打包
npm run lint     # Obsidian 官方 ESLint 规则
```

- 两项都通过后才能提交
- CI（Node 20.x/22.x 矩阵）执行相同检查
- 禁止 `eslint-disable` 绕过 `obsidianmd/*` 规则

## 新增功能开发流程

1. **新增图床服务商**：继承 `UploaderBase`，实现 `upload()` + `testConnection()`，在 `uploader-factory.ts` 注册，在 `hosting-config.ts` 添加配置字段
2. **新增 Modal**：继承 Obsidian `Modal`，参考 `modals/` 下现有组件
3. **新增命令**：在 `main.ts` 的 `addCommand()` 注册，复杂逻辑提取到独立模块
4. **新增设置项**：在 `types.ts` 的 `ImageManagerSettings` + `DEFAULT_SETTINGS` 中添加，在 `settings.ts` 中渲染 UI
5. **新增翻译**：在 `i18n/en.ts` 和 `i18n/zh.ts` 中添加键值对

## 待实现功能

- **图床迁移**：命令已注册（`migrate-images`），类型已定义（`MigrationRecord`/`MigrationChange`），显示"未实现"提示
- **恢复本地引用**：翻译键已存在（`command.restoreLocalRefs` 等），无实现代码

## 注意事项

- `data.json` 包含测试用 API 密钥，已在 `.gitignore` 中
- `main.js` 是构建产物，不要手动编辑
- 发布产物：`main.js` + `manifest.json` + `styles.css`
- Obsidian 内置重命名会剥离 Markdown 引用的目录路径，插件通过 `vault rename` 事件 + `fixBrokenImageRefs` 修复

## 已修复问题

### IME 输入法回车触发表单提交（1.0.1）

- **问题**：中文输入法按回车确认选字时触发表单提交
- **修复**：`keydown` 事件添加 `if (e.isComposing) return;`
- **文件**：`image-name-prompt.ts`、`rename-image.ts`、`confirm-dialog.ts`

### 重命名丢失目录路径（1.0.5）

- **问题**：Obsidian 内置重命名将 `![alt](assets/folder/old.png)` 变为 `![alt](new.png)`
- **修复**：监听 `vault rename` 事件，调用 `fixBrokenImageRefs` 恢复目录路径
- **时序**：`window.setTimeout(() => {...}, 100)` 等待 Obsidian 完成内置更新

### 引用计数错误（1.0.7）

- **问题**：同一篇笔记引用 5 次显示"1 note(s)"而非"5 reference(s)"
- **修复**：统计所有引用而非仅去重笔记数
