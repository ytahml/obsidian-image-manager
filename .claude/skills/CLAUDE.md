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
