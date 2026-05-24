# Obsidian 图片管理插件 — 开发计划

## 一、项目概述

**目标：** 开发一款 Obsidian 社区插件，提供笔记内图片的统一管理、浏览、优化和组织能力。

**核心功能方向：**
- 图片资源的集中浏览与搜索
- 全库图片文件检索与高级筛选
- 图片压缩与格式优化
- 孤立图片检测（未被任何笔记引用的图片）
- 图片批量重命名、移动、删除
- 图片插入流程优化（拖拽、粘贴、快捷键）
- 图片元数据查看与编辑
- 图片引用格式转换（标准 Markdown ↔ Obsidian Wiki 风格）
- 图片上传至图床（阿里云 OSS、坚果云、S3 兼容服务、自定义图床）
- 图片批量迁移至指定图床（本地 → 图床、图床 A → 图床 B）

---

## 二、环境准备

### 2.1 必备软件

| 工具 | 最低版本 | 用途 |
|------|---------|------|
| **Node.js** | v18+ | 运行时环境 |
| **npm** | v9+ | 包管理器 |
| **Git** | 最新版 | 版本控制 |
| **Obsidian** | v1.4+ | 测试宿主环境 |
| **VS Code** (推荐) | 最新版 | 开发 IDE |

安装验证：

```bash
node --version   # >= 18
npm --version    # >= 9
git --version
```

### 2.2 VS Code 推荐扩展

- **ESLint** — 代码规范检查
- **Prettier** — 代码格式化
- **TypeScript Nightly** — 最新 TS 特性支持
- **Obsidian Plugin Snippets** (可选) — API 代码片段

### 2.3 初始化项目

```bash
# 方式一：从官方示例插件模板创建（推荐）
npx create-obsidian-plugin --name obsidian-image-manager
cd obsidian-image-manager
npm install

# 方式二：手动 clone 官方 sample-plugin
git clone https://github.com/obsidianmd/obsidian-sample-plugin.git obsidian-image-manager
cd obsidian-image-manager
rm -rf .git
git init
npm install
```

### 2.4 项目目录结构

```
obsidian-image-manager/
├── .github/                        # GitHub Actions (CI/CD)
│   └── workflows/
│       └── release.yml
├── src/
│   ├── main.ts                     # 插件入口 (Plugin subclass)
│   ├── settings.ts                 # 设置面板定义
│   ├── i18n/                       # 国际化
│   │   ├── index.ts                # i18n 核心 (t(), setLocale())
│   │   ├── en.ts                   # 英文翻译
│   │   └── zh.ts                   # 中文翻译
│   ├── modals/
│   │   ├── image-browser.ts        # 图片浏览器 Modal
│   │   ├── image-preview.ts        # 图片预览 Modal
│   │   ├── upload-confirm.ts       # 上传确认对话框
│   │   └── confirm-dialog.ts       # 通用确认对话框
│   ├── views/
│   │   ├── image-gallery.ts        # 侧边栏图片画廊 View
│   │   └── upload-queue.ts         # 上传队列面板
│   ├── utils/
│   │   ├── image-scanner.ts        # 图片文件扫描与检索
│   │   ├── image-optimizer.ts      # 图片压缩优化
│   │   ├── orphan-finder.ts        # 孤立图片检测
│   │   ├── ref-converter.ts        # 图片引用格式转换
│   │   └── path-utils.ts           # 路径工具函数
│   ├── uploaders/
│   │   ├── uploader-base.ts        # 图床上传器基类/接口
│   │   ├── uploader-factory.ts     # 上传器工厂
│   │   ├── aliyun-oss.ts           # 阿里云 OSS 上传器
│   │   ├── qiniu.ts                # 七牛云上传器
│   │   ├── s3-compatible.ts        # S3 兼容上传器 (AWS/坚果云/MinIO)
│   │   ├── smms.ts                 # SM.MS 免费图床
│   │   └── custom-uploader.ts      # 自定义图床 (WebDAV/REST API)
│   ├── migrator/
│   │   ├── image-migrator.ts       # 图片迁移引擎
│   │   └── ref-rewriter.ts         # 迁移后引用地址改写
│   ├── types.ts                    # 类型定义
│   └── constants.ts                # 常量定义
├── styles.css                      # 插件样式
├── manifest.json                   # 插件清单
├── versions.json                   # 版本兼容性映射
├── esbuild.config.mjs              # 构建配置
├── tsconfig.json                   # TypeScript 配置
├── package.json
├── .eslintrc.json
├── .prettierrc
├── .gitignore
└── README.md
```

---

## 三、关键技术栈

| 类别 | 技术 | 说明 |
|------|------|------|
| 语言 | **TypeScript 5.x** | Obsidian 插件的标准开发语言 |
| 构建 | **esbuild** | 官方示例插件默认使用，速度快 |
| 图片处理 | **Canvas API** | 浏览器端图片压缩与格式转换（零依赖） |
| 阿里云 OSS | **REST API + requestUrl** | 使用 Obsidian 内置 HTTP 客户端，避免 CORS |
| S3 兼容存储 | **REST API + AWS Sig V4** | Web Crypto API 实现签名，零依赖 |
| 七牛云 | **REST API + requestUrl** | 七牛云上传 |
| HTTP 请求 | **Obsidian `requestUrl`** | 插件内置 HTTP 客户端，避免 CORS 问题 |
| 测试 | **Vitest** | 单元测试框架 |
| 代码规范 | **ESLint + Prettier** | 代码质量保证 |
| CI/CD | **GitHub Actions** | 自动化构建与发布 |

---

## 四、Obsidian API 核心概念

### 4.1 插件生命周期

```typescript
import { Plugin } from 'obsidian';

export default class ImageManagerPlugin extends Plugin {
    async onload() {
        // 1. 加载设置
        await this.loadSettings();

        // 2. 注册设置面板
        this.addSettingTab(new ImageManagerSettingTab(this.app, this));

        // 3. 注册命令
        this.addCommand({ id: 'browse-images', name: 'Browse Images', callback: () => {...} });

        // 4. 注册侧边栏视图
        this.registerView(VIEW_TYPE_IMAGE_GALLERY, (leaf) => new ImageGalleryView(leaf));

        // 5. 注册事件监听
        this.registerEvent(this.app.vault.on('create', this.onFileCreated.bind(this)));

        // 6. 注册右键菜单
        this.registerEvent(this.app.workspace.on('file-menu', this.onFileMenu.bind(this)));
    }

    async onunload() {
        // 清理资源
    }
}
```

### 4.2 关键 API 一览

| API | 用途 |
|-----|------|
| `app.vault.getFiles()` | 获取所有文件 |
| `app.vault.readBinary(file)` | 读取二进制文件（图片） |
| `app.vault.modifyBinary(file, data)` | 修改二进制文件 |
| `app.vault.create(path, data)` | 创建新文件 |
| `app.vault.delete(file)` | 删除文件 |
| `app.vault.rename(file, newPath)` | 重命名/移动文件 |
| `app.vault.getMarkdownFiles()` | 获取所有 Markdown 文件 |
| `app.vault.cachedRead(file)` | 读取文件文本（缓存优化） |
| `app.vault.process(file, fn)` | 原子性修改文件文本内容 |
| `app.metadataCache.getFileCache(file)` | 获取文件缓存（含引用） |
| `app.metadataCache.resolvedLinks` | 全库解析后的链接关系 |
| `app.metadataCache.iterateReferences(cb)` | 遍历文件中所有引用 |
| `requestUrl(req)` | Obsidian 内置 HTTP 客户端（无 CORS 限制） |
| `app.workspace.getLeavesOfType(type)` | 获取指定类型的视图 |
| `MarkdownView` | 当前编辑器视图 |
| `PluginSettingTab` | 设置面板基类 |
| `Modal` | 弹窗基类 |
| `ItemView` | 侧边栏面板基类 |

---

## 五、开发阶段规划

### Phase 1：基础框架 ✅ 已完成

- [x] 搭建项目脚手架，确认构建/热重载流程可用
- [x] 实现 `manifest.json` 和基本插件注册
- [x] 实现图片文件扫描器 (`vault.getFiles()` + MIME 过滤)
- [x] 实现设置面板（图片存放目录、支持的格式等基础配置）
- [x] 注册基本命令（打开图片浏览器）
- [x] 实现 i18n 双语系统（中文/英文）
- [x] 实现图片浏览器 Modal（缩略图网格、搜索、排序、点击插入）
- [x] 实现通用确认对话框 Modal

### Phase 2：全库图片检索与浏览器 🔶 基础完成，高级功能延后

> **说明：** 基础图片浏览器已在 Phase 1 实现（缩略图网格、搜索、排序、点击插入）。以下高级功能因需要支持远程 URL 引用检索而延后。

- [x] 实现全库图片文件检索引擎（`ImageScanner` + `vault.getFiles()`）
- [x] 基础筛选：按关键词搜索
- [x] 排序支持：按名称 / 大小 / 修改时间 / 创建时间
- [x] 图片缩略图网格展示（`ImageBrowserModal`）
- [x] 点击插入图片引用到编辑器
- [ ] 高级筛选：按扩展名、文件大小范围、所在目录
- [ ] 实现侧边栏画廊视图 (`ItemView` 子类)
- [ ] 虚拟滚动优化大图库
- [ ] 图片预览 Modal（大图查看 + 基本信息）
- [ ] 拖拽插入图片到编辑器
- [ ] 右键菜单：在文件管理器中显示 / 复制路径 / 复制引用
- [ ] 支持检索图床远程 URL 图片引用

### Phase 3：图片优化 ✅ 已完成

- [x] 集成图片压缩库（Canvas API，零依赖）
- [x] 单张图片压缩（命令：Compress current image）
- [x] 图片格式转换（WebP/JPG/PNG 互转）
- [x] 压缩前后大小对比（显示节省百分比）
- [x] 批量图片压缩（通过批量上传流程自动压缩）
- [x] 自动压缩：上传时可选自动优化（设置：autoCompress + compressQuality）
- [ ] 压缩前后对比预览

### Phase 4：智能管理与引用格式转换 🔶 大部分完成

- [x] 孤立图片检测（扫描 `![[...]]` 和 `![](...)` 引用）
- [x] 未引用图片列表与批量清理（命令：Find orphan images）
- [x] 图片批量重命名（同步更新引用，命令：Rename image）
- [x] 图片引用格式转换引擎：
  - [x] 支持单篇笔记转换（命令：Convert reference format (current note)）
  - [x] 支持全库批量转换（命令：Convert reference format (entire vault)）
  - [x] 标准 Markdown ↔ Obsidian Wiki 互转
  - [ ] 转换前预览 diff，确认后执行
  - [ ] 保留 alt 文本信息（Wiki 格式转 MD 时使用文件名）
- [ ] 图片分类/标签系统
- [ ] 图片使用统计

### Phase 5：图床上传 ✅ 已完成

- [x] 设计图床上传器抽象接口 (`UploaderBase`)
- [x] 实现上传器工厂 (`createUploader`)
- [x] 实现阿里云 OSS 上传器（REST API + HMAC-SHA1 签名）
  - [x] 配置：Endpoint、Bucket、AccessKey、自定义域名
  - [x] 支持自定义上传路径模板（如 `images/{year}/{month}/{filename}`）
- [x] 实现七牛云上传器（REST API + 上传凭证生成）
  - [x] 配置：AK/SK、Bucket、域名
- [x] 实现 S3 兼容上传器（REST API + AWS Signature V4）
  - [x] 配置：Endpoint、Bucket、Region、AccessKey/SecretKey
  - [x] 支持 path-style 和 virtual-hosted style
- [x] 实现 SM.MS 免费图床上传器（无需配置，开箱即用）
- [x] 实现自定义图床上传器
  - [x] REST API 自定义（URL/Header/Body 模板配置）
  - [ ] WebDAV 协议支持
- [x] 上传完成后自动复制 URL 到剪贴板
- [x] 上传完成后自动替换笔记中的本地引用为图床 URL
- [x] 多图床配置选择（SuggestModal 选择器）
- [x] 上传队列管理（进度条、失败重试 3 次、并发控制）
- [x] 批量上传命令（命令：Batch upload all images）
- [ ] 上传历史记录持久化查询

### Phase 6：图片迁移 ⏳ 待开发

- [ ] 图片迁移引擎设计（Source → Target 抽象模型）
- [ ] 本地图片 → 图床迁移
  - 选择图片范围（单张 / 按目录 / 全库）
  - 选择目标图床
  - 批量上传 + 自动改写所有笔记中的引用地址
- [ ] 图床 → 图床迁移（更换图床服务商）
  - 从原图床下载图片
  - 上传至新图床
  - 批量更新所有笔记中的 URL
- [ ] 迁移前预览（影响哪些笔记、变更内容 diff）
- [ ] 迁移进度显示与断点续传
- [ ] 迁移回滚（记录变更日志，支持撤销）
- [ ] 设置迁移后的默认上传图床

### Phase 7：打磨与发布 ⏳ 待开发

- [ ] 完善错误处理与边界情况
- [ ] 添加单元测试（重点覆盖引用转换和图床上传）
- [ ] 编写 README 和用户文档
- [ ] 性能优化（大图库场景）
- [ ] 提交至 Obsidian 社区插件列表
- [ ] 发布首个正式版本 (1.0.0)

---

## 六、开发工作流

### 6.1 日常开发

```bash
# 启动开发模式（自动监听文件变化，自动重新构建）
npm run dev

# 在 Obsidian 中启用插件：
# Settings → Community plugins → 已安装插件 → 开启 "Image Manager"
# 开发模式下修改代码后，Obsidian 会自动热重载
```

### 6.2 构建发布

```bash
# 生产构建（生成 main.js）
npm run build

# 版本号更新
npm run version   # 自动更新 manifest.json 和 versions.json 中的版本号
```

### 6.3 发布清单

每次发布需包含以下三个文件到 GitHub Release：

```
main.js          # 构建产物
manifest.json    # 插件清单
styles.css       # 样式文件（可选）
```

---

## 七、manifest.json 示例

```json
{
    "id": "obsidian-image-manager",
    "name": "Image Manager",
    "version": "1.0.0",
    "minAppVersion": "1.4.0",
    "description": "A powerful image management plugin for Obsidian. Browse, optimize, upload to image hosting, and organize your images.",
    "author": "Your Name",
    "authorUrl": "https://github.com/yourusername",
    "isDesktopOnly": false,
    "fundingUrl": ""
}
```

---

## 八、注意事项与最佳实践

### 8.1 开发注意

- **不要阻塞主线程：** 图片扫描和压缩等耗时操作使用 `requestIdleCallback` 或分批处理
- **适配多平台：** 路径处理使用 Obsidian 的 `normalizePath()` 而非 Node.js 的 `path` 模块
- **移动端兼容：** 桌面端特有的 API（如 `require('fs')`）需做环境检测
- **数据安全：** 删除/移动文件前务必确认，避免误操作导致用户数据丢失
- **HTTP 请求统一用 `requestUrl`：** 图床上传务必使用 Obsidian 内置的 `requestUrl()` 而非 `fetch`/`axios`，避免 CORS 和混合内容问题
- **密钥存储：** 图床凭证（AK/SK）仅存于插件 `data.json`（Obsidian 自动管理），不写入日志、不上传、不回传
- **引用改写原子性：** 使用 `app.vault.process()` 替换笔记内容，确保读-改-写的原子操作

### 8.2 测试策略

- 使用 `obsidian-mock` 或自建 mock 对 `App` 和 `Vault` 进行单元测试
- 在真实 Obsidian 环境中进行手动集成测试
- 测试不同大小的 vault（100 / 1000 / 10000+ 张图片）的性能表现

### 8.3 参考资源

| 资源 | 链接 |
|------|------|
| Obsidian 插件开发文档 | https://docs.obsidian.md/Plugins/Getting+started |
| Obsidian API 类型定义 | https://github.com/obsidianmd/obsidian-api |
| 官方示例插件 | https://github.com/obsidianmd/obsidian-sample-plugin |
| 社区插件列表 | https://github.com/obsidianmd/obsidian-releases |
| 开发者论坛 | https://forum.obsidian.md/c/developers/6 |

---

## 九、风险与应对

| 风险 | 影响 | 应对方案 |
|------|------|---------|
| 大型 vault 扫描性能差 | 用户体验下降 | 分页加载 + 虚拟滚动 + 后台索引 |
| 图片压缩质量损失 | 用户不满 | 提供多档压缩级别，默认保守 |
| 移动端 API 限制 | 功能受限 | 明确标注桌面专属功能，移动端做降级 |
| Obsidian API 变更 | 插件兼容性 | 关注 API changelog，设置 `minAppVersion` |
| 社区插件审核周期长 | 发布延迟 | 提前阅读审核指南，确保符合规范 |
| 引用格式转换误改 | 笔记内容损坏 | 转换前生成 diff 预览，保留备份，支持撤销 |
| 图床 API 密钥安全 | 用户凭证泄露 | 密钥仅存本地 `data.json`，不上传不回传 |
| 图床服务商 API 变更 | 上传功能失效 | 抽象上传接口 + 适配器模式，隔离变更影响 |
| 图床上传失败/中断 | 部分图片丢失引用 | 队列重试机制 + 迁移断点续传 + 变更日志回滚 |
| 图床迁移后链接失效 | 笔记中图片无法显示 | 先验证新链接可用再批量替换，保留迁移日志 |
| 第三方 SDK 体积过大 | 插件包体积超标 | 全部使用 Obsidian `requestUrl` + REST API，零外部依赖 |

---

## 十、附录：图床配置模型

### 10.1 统一配置结构

```typescript
interface ImageHostingConfig {
    id: string;              // 唯一标识
    name: string;            // 用户自定义名称，如 "我的阿里云"
    type: 'aliyun-oss' | 'qiniu' | 's3' | 'smms' | 'custom';
    enabled: boolean;
    config: AliyunOSSConfig | QiniuConfig | S3Config | SmmsConfig | CustomConfig;
    uploadPath: string;      // 上传路径模板，如 "images/{year}/{month}/{hash}.{ext}"
    urlPrefix: string;       // 自定义域名前缀，如 "https://img.example.com"
}

// 阿里云 OSS 配置
interface AliyunOSSConfig {
    region: string;          // 如 "oss-cn-hangzhou"
    accessKeyId: string;
    accessKeySecret: string;
    bucket: string;
}

// 自定义图床配置
interface CustomConfig {
    uploadUrl: string;           // 上传接口 URL
    method: 'POST' | 'PUT';
    headers: Record<string, string>;   // 自定义请求头
    fileFieldName: string;       // 文件字段名
    jsonPath: string;            // 返回 JSON 中取 URL 的路径，如 "data.url"
    extraBody: Record<string, string>; // 额外表单字段
}
```

### 10.2 上传路径模板变量

| 变量 | 说明 | 示例 |
|------|------|------|
| `{year}` | 当前年份 | `2026` |
| `{month}` | 当前月份 | `05` |
| `{day}` | 当前日期 | `23` |
| `{filename}` | 原始文件名（不含扩展名） | `screenshot` |
| `{hash}` | 文件内容 MD5 前 8 位 | `a3f1b2c4` |
| `{ext}` | 文件扩展名 | `png` |
| `{timestamp}` | Unix 时间戳 | `1748006400` |

示例：`images/{year}/{month}/{hash}.{ext}` → `images/2026/05/a3f1b2c4.png`

---

## 十一、附录：引用格式转换详细设计

### 11.1 两种格式对照

| 场景 | 标准 Markdown | Obsidian Wiki |
|------|--------------|---------------|
| 基本引用 | `![](image.png)` | `![[image.png]]` |
| 带 alt 文本 | `![风景照片](image.png)` | `![[image.png\|风景照片]]` |
| 指定尺寸 | `![](image.png)` | `![[image.png\|200x300]]` |
| 引用子目录 | `![](assets/img.png)` | `![[assets/img.png]]` |
| 引用其他笔记附件 | `![](../other/img.png)` | `![[img.png]]` |

### 11.2 转换策略

**Markdown → Wiki 转换规则：**
1. 解析 `![alt](path)` 正则匹配
2. 提取文件名（去掉路径前缀，Obsidian Wiki 格式可自动解析同名文件）
3. 如果有 alt 文本，拼接为 `![[filename|alt]]`
4. 如果 alt 文本与文件名相同则省略：`![[filename]]`

**Wiki → Markdown 转换规则：**
1. 解析 `![[path|alt]]` 或 `![[path|WxH]]` 正则匹配
2. 保留原始路径（含相对路径信息）
3. 如果有 alt 文本，填入 `![alt](path)`
4. 如果有尺寸参数 `WxH`，alt 填为 `WxH`（或忽略，视用户设置）

### 11.3 安全措施

- 转换前扫描并统计影响范围（多少篇笔记、多少处引用）
- 生成变更预览 diff（逐篇展示 before/after）
- 用户确认后才执行写入
- 执行前自动备份原文件（可选，放入 `.obsidian/plugins/image-manager/backups/`）
- 提供一键回滚命令
