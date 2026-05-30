# Obsidian Image Manager — 开发指南

## 项目概述

Obsidian 图片管理插件，TypeScript 编写，使用 Obsidian Plugin API。核心功能：图片压缩、图床上传（4 种服务商）、引用格式转换、图片浏览器、孤立图片检测、资源整理。

## 技术约束

- **零外部运行时依赖** — 仅依赖 `obsidian` 包
- 加密用 Web Crypto API（`crypto.subtle`），HTTP 用 Obsidian `requestUrl`
- 剪贴板操作用 `require('electron')`，移动端不兼容
- ESM 源码，esbuild 打包为 CJS `main.js`
- TypeScript strict 模式

## 构建命令

```bash
npm run dev      # watch 模式开发
npm run build    # 生产构建（tsc 检查 + esbuild 压缩）
npm run lint     # ESLint 检查
```

## CI/CD

### Lint & Build（`.github/workflows/lint.yml`）

- 触发：push/PR 到 `master`
- Node 20.x / 22.x 矩阵
- 执行：`npm ci` → `npm run build` → `npm run lint`

### Release（`.github/workflows/release.yml`）

- 触发：推送 tag（如 `1.0.0`）
- 执行：`npm ci` → `npm run build` → 打包 `main.js` + `manifest.json` + `styles.css` 为 zip
- 使用 `softprops/action-gh-release@v2` 创建 GitHub Release 并上传 4 个产物（`main.js`、`manifest.json`、`styles.css`、`obsidian-image-manager.zip`）

#### 发布流程

```bash
# 1. 更新 manifest.json 中的 version
# 2. 提交
git add -A && git commit -m "release: vX.Y.Z"
# 3. 打 tag 并推送
git tag X.Y.Z
git push origin master --tags
# 4. GitHub Actions 自动创建 Release 并上传产物
```

## 架构

```
src/
├── main.ts              # 入口、命令注册、事件处理、粘贴/拖放编排（~982 行，待拆分）
├── settings.ts          # 设置面板 UI
├── types.ts             # 类型定义 + DEFAULT_SETTINGS
├── constants.ts         # 正则、MIME 映射
├── i18n/                # 国际化（中/英，~180 条翻译）
├── modals/              # 7 个 Modal 组件（浏览器、预览、孤立检测、配置表单等）
├── uploaders/           # 4 个上传器 + 工厂 + 并发队列
└── utils/               # 7 个工具模块（引用转换、扫描、压缩、重命名、整理等）
```

## 关键模块说明

### 上传器体系 (`src/uploaders/`)
- `UploaderBase` 抽象基类，定义 `upload()` 和 `testConnection()`
- `createUploader()` 工厂按 `HostingType` 实例化
- 4 种实现：`AliyunOSSUploader`、`QiniuUploader`、`S3Uploader`、`CustomUploader`
- `UploadQueue`：3 并发、3 次重试、进度回调

### 引用格式 (`src/utils/ref-converter.ts`)
- 两种格式：Markdown `![alt](path)` 和 Wiki `![[path|alt]]`
- `RefConverter` 负责解析、转换、相对路径计算
- 转换时反向处理以保持字符索引

### 设置门控逻辑
- `reorganizeConvertFormat`（使用 MD 标准格式）是图床功能的前置条件
- `skipWikiRefsOnReorganize` 控制整理时是否跳过 Wiki 引用
- 两个设置组合产生 4 种行为，见 README 设置组合表

### 粘贴/拖放处理 (`main.ts` L627-948)
- 拦截 `editor-paste` 和 `editor-drop` 事件
- 命名模板变量替换 → 文件保存 → 引用插入 → 可选自动上传

## 编码规范

- 遵循 AGENTS.md 中的 Obsidian 插件开发指南
- 单文件建议 200-300 行以内，超长需拆分
- 使用 `this.register*` 注册所有监听器，确保卸载时清理
- UI 文本使用 `t('key')` 国际化函数
- 路径处理使用 `path-utils.ts` 中的工具函数
- 图片引用正则在 `constants.ts` 中定义（`MD_IMAGE_REGEX`、`WIKI_IMAGE_REGEX`）

## ESLint 配置

项目使用 `typescript-eslint` 的 `recommendedTypeChecked` 规则集，配合 `eslint-plugin-obsidianmd`。

### 关键规则

| 规则 | 说明 |
| --- | --- |
| `@typescript-eslint/no-floating-promises` | Promise 必须 await、.catch、.then 或用 `void` 显式忽略 |
| `@typescript-eslint/no-misused-promises` | 回调不能返回 Promise（用 `void` 包装或改为非 async） |
| `@typescript-eslint/no-unsafe-assignment` | 禁止 `any` 类型赋值，需添加类型断言 |
| `@typescript-eslint/no-unsafe-member-access` | 禁止在 `any` 上访问成员 |
| `@typescript-eslint/require-await` | async 函数必须包含 await |
| `@typescript-eslint/restrict-template-expressions` | 模板字符串不能使用 `never` 类型 |
| `obsidianmd/ui/sentence-case` | UI 文本使用 sentence case（首字母大写，其余小写） |
| `obsidianmd/settings-tab/no-manual-html-headings` | 使用 `new Setting().setName().setHeading()` 代替 `createEl('h3')` |
| `obsidianmd/no-static-styles-assignment` | 使用 CSS 类代替 `element.style.*` 直接赋值 |
| `obsidianmd/no-tfile-tfolder-cast` | 使用 `instanceof TFile` 代替 `as TFile` 类型断言 |
| `obsidianmd/prefer-file-manager-trash-file` | 使用 `fileManager.trashFile()` 代替 `vault.delete()` |
| `no-console` | 仅允许 `console.warn`、`console.error`、`console.debug` |

### 常见修复模式

```typescript
// 1. 浮动 Promise — 添加 void
void this.handleConfirm();
void doUpload(config);

// 2. 回调返回 Promise — 改为非 async 或用 void 包装
// ❌
new Modal(app, async (saved) => { await save(); });
// ✅
new Modal(app, (saved) => { void save().then(() => display()); });

// 3. JSON.parse 类型安全
this.config = JSON.parse(JSON.stringify(config)) as ImageHostingConfig;

// 4. resp.json 类型安全
const json = resp.json as { key?: string; error?: string };

// 5. Array().fill() 类型安全
// ❌
const ups: string[] = Array(count).fill('..');
// ✅
const ups: string[] = Array.from({ length: count }, () => '..');

// 6. Sentence case — 品牌名保持原样，技术术语小写
'Access key ID'  // ✅
'Access Key ID'  // ❌

// 7. 设置标题
// ❌
containerEl.createEl('h3', { text: '标题' });
// ✅
new Setting(containerEl).setName('标题').setHeading();

// 8. TFile 类型安全
// ❌
const file = vault.getAbstractFileByPath(path) as TFile;
// ✅
const file = vault.getAbstractFileByPath(path);
if (!(file instanceof TFile)) throw new Error('Not a file');
```

## 新增功能开发流程

1. **新增图床服务商**：继承 `UploaderBase`，实现 `upload()` 和 `testConnection()`，在 `uploader-factory.ts` 注册，在 `hosting-config.ts` 添加配置字段
2. **新增 Modal**：继承 Obsidian `Modal`，参考 `modals/` 下现有组件
3. **新增命令**：在 `main.ts` 的 `addCommand()` 注册，复杂逻辑提取到独立模块
4. **新增设置项**：在 `types.ts` 的 `ImageManagerSettings` 和 `DEFAULT_SETTINGS` 中添加，在 `settings.ts` 中渲染 UI
5. **新增翻译**：在 `i18n/en.ts` 和 `i18n/zh.ts` 中添加键值对

## 待实现功能

- **图床迁移**：命令已注册（`migrate-images`），显示"未实现"提示
- **恢复本地引用**：翻译键已存在（`command.restoreLocalRefs` 等），无实现代码

## 注意事项

- `data.json` 包含测试用 API 密钥，已在 `.gitignore` 中
- `main.js` 是构建产物，不要手动编辑
- 发布产物：`main.js` + `manifest.json` + `styles.css`
- CI 在 Node 20.x/22.x 上运行 build + lint

## 已修复问题

### IME 输入法回车触发表单提交（2026-05-30 修复）

- **问题**：中文输入法下按回车确认选字时，会直接触发表单提交，导致图片名称未正确输入
- **根因**：`keydown` 事件未检查 `e.isComposing` 状态
- **修复文件**：
  - `modals/image-name-prompt.ts` 第 45 行
  - `modals/rename-image.ts` 第 57 行
  - `modals/confirm-dialog.ts` 第 22 行
- **修复方式**：在 keydown 事件处理中添加 `if (e.isComposing) return;`
- **效果**：输入法组合状态下（如拼音选字）按回车不会触发提交，只有输入法关闭后按回车才会触发
