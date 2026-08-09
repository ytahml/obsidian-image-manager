# 设置、Modal 与国际化

## 设置模型与默认值

`ImageManagerSettings` 的持久化字段：

| 字段 | 默认值 | 业务作用 |
|---|---|---|
| `locale` | `en` | `en` / `zh` |
| `imagePathTemplate` | `attachments` | 粘贴图片目标路径 |
| `imagePathBase` | `note` | `vault` / `note` 路径基准 |
| `supportedExtensions` | png/jpg/jpeg/gif/bmp/svg/webp/ico/tiff/avif | 本地扫描与命令识别 |
| `localManagementMode` | `managed` | 新附件本地管理权：`managed` / `delegated` |
| `managedPasteReferenceFormat` | `markdown` | managed 粘贴引用格式 |
| `compressManagedPasteLocal` | false | managed 粘贴时修改本地附件 |
| `compressBeforeUpload` | false | 只压缩上传载荷 |
| `compressQuality` | 80 | 1–100 |
| `thumbnailSize` | 200 | 本地卡片 80–400 |
| `imageNamingTemplate` | `image-{timestamp}` | 粘贴命名 |
| `promptImageName` | false | 粘贴/拖放命名 Modal |
| `hostingConfigs` | `[]` | 图床列表 |
| `defaultHostingId` | `''` | 多个启用图床时的默认项 |
| `uploadPathTemplate` | `images/{year}/{month}/{hash}.{ext}` | 原生图床全局 fallback |
| `autoReplaceAfterUpload` | false | 上传后替换本地引用 |
| `customReferenceTemplate` | `''` | 上传后自定义文本引用 |
| `reorganizeConvertFormat` | true | 显式整理时是否转换为 Markdown |
| `skipWikiRefsOnReorganize` | true | 整理时是否跳过 Wiki |
| `enableImageBrowser` | true | ribbon 与 browser command |
| `autoUploadOnPaste` | false | 粘贴后自动上传 |
| `keepLocalCopy` | false | 自动上传后是否保留本地文件 |
| `remoteDeleteHistory` | `[]` | 最近 200 条脱敏诊断 |

加载设置使用 `Object.assign({}, DEFAULT_SETTINGS, loaded)` 兼容旧 data，不能修改默认值对象；新增字段必须提供默认值和必要规范化。

## 本地管理与图床接力

`localManagementMode` 只决定自动 paste/drop 的本地管理权；`autoUploadOnPaste` 独立决定是否接续图床上传。`managedPasteReferenceFormat` 只影响 managed 初始引用，`reorganizeConvertFormat` 只影响显式整理。手动上传与自动上传均不受这两个格式设置门控。

Obsidian 1.13 声明式设置页在 delegated 下禁用并解释路径、命名、命名提示、managed 引用格式和本地粘贴压缩，同时保留其值；图床接力设置继续可编辑。

## Obsidian 1.13 声明式设置

`minAppVersion` 为 1.13.0，不再兼容旧 imperative 设置 API：

- `getSettingDefinitions()` 是唯一设置入口，提供渲染与搜索索引；不实现 `display()` fallback。
- 普通单字段设置优先使用 `control` 自动绑定；需要副作用、即时草稿校验或动态复杂 UI 时使用 `setControlValue()` 或 `render`。
- 语言、本地管理模式和图床列表变化后调用 `update()`，重新生成本地化文案、禁用状态或动态列表结构。
- delegated 模式通过声明式 `disabled` 谓词禁用 managed 专属控件，图床接力设置保持可编辑。

新增设置步骤：

1. 更新 `ImageManagerSettings` 和 `DEFAULT_SETTINGS`。
2. 更新声明式定义；只有复杂 UI 才使用 `render`。
3. 添加中英文名称、描述、placeholder/notice。
4. 保存时规范化空值，必要时刷新设置页。
5. 为业务默认值、门控和兼容迁移补测试。

## 图床设置列表

列表每项显示状态、名称、类型，以及启用/禁用、编辑、删除：

- 启用状态在列表直接切换，不在配置 Modal 重复。
- 禁用当前 default 时选择下一个启用配置。
- 只有两个及以上启用配置时显示 default dropdown。
- 删除使用通用 ConfirmDialog，保存后刷新。

新增配置默认类型为 Aliyun OSS、enabled=true、上传路径与 public base 为空。

## HostingConfigModal

Modal 分为固定基础区和 capability 门控正文：

- 顶部编辑名称和类型；宽屏并排，窄屏上下排列。
- 非 Custom 的上传路径和公共访问 URL 位于页签上方。
- 上传路径留空时使用全局模板，输入框 placeholder 直接复用 `DEFAULT_UPLOAD_PATH_TEMPLATE`，不能维护另一份默认字符串。
- 页签为“图床配置 / 远程管理”；只有 production Provider 有 `list` 时显示远程页签。
- Custom 不显示无效远程页签，也不显示原生图床的上传路径/public base。
- 页签切换复用内存配置副本，不丢失未保存输入。
- 正文独立滚动，保存/取消固定可见。

服务商字段：

| 类型 | 字段 |
|---|---|
| Aliyun OSS | region、accessKeyId、accessKeySecret、bucket |
| Qiniu | accessKey、secretKey、bucket、region |
| S3 | endpoint、region、accessKeyId、secretAccessKey、bucket、forcePathStyle |
| Custom | uploadUrl、method、headers、fileFieldName、jsonPath、extraBody |

### 远程管理字段

- enabled：旧配置默认 false。
- prefix：空值表示当前 bucket 根；保存时仅清理首尾 `/`。
- previewAccess：`presigned | public`；旧配置默认 presigned。
- publicUrlAliases：多行、一行一个，只接受无账号/query/fragment 的 HTTP(S) base。
- pageSize/previewMode：保留旧 data 兼容，当前 UI 不再暴露分页或手动缩略图模式。

远程管理关闭时折叠后续字段。帮助文案必须说明显式扫描后 viewport 图片会产生对象读取与原图流量，不提供独立 delete toggle。

## 本地与远程浏览 UI

共同外壳：

- 标题与“本地图片 / 图床图片”页签在响应式 header。
- 桌面 Modal 最大约 1100px × 84vh；移动端保留 8–12px 安全边距。
- 切页与关闭要释放 observer/URL/session，并隔离迟到任务。

状态语义保持一致：

- 绿色：已引用
- 橙色：孤立图片
- 灰色：无法判断

远程扫描、空 prefix 确认和异步 ConfirmDialog：

- pending 时显示 spinner、`aria-busy`，禁用重复提交。
- 错误只映射结构化分类，不显示 XML/JSON 原文、endpoint secret 或签名 URL。
- loading 位于图片画布，成功不重复显示“已加载”文案。
- 远程预览的完整 key 使用“远程路径”标签，与本地信息层级一致。

## Modal 通用约束

- 有 Enter 提交的输入框必须先检查 `event.isComposing`。
- Escape 取消，Enter 提交；异步提交期间防重复。
- onClose 清理 content、listener、observer、临时 URL 和会话。
- 使用 Obsidian ButtonComponent/Setting/DOM helpers，避免手写不兼容结构。
- 标题使用 `new Setting().setName(...).setHeading()`，不要创建手写 h3。
- 事件与查询使用 `activeDocument`；timer 使用 `window.*`。

## CSS 与主题

- 使用 plugin 根类限定 selector。
- 不使用 `!important`；提高局部 selector specificity。
- 不使用重复 height/max-height 作为单位 fallback；当前移动端可直接使用 `dvh`。
- 不通过 element.style 批量写静态样式；动态缩略图尺寸等运行时值除外，优先 CSS variable/class。
- 少量卡片按内容高度贴顶，不能被 grid 剩余高度拉伸。
- 确保 keyboard focus、aria-label/aria-busy 与移动端控件可操作。

## i18n

`src/i18n/index.ts` 提供 `setLocale()` 与 `t(key, vars)`。键分组包括 command、settings、notice、ribbon、preview、browser、orphan、modal。

规则：

- 新 UI 字符串必须同时添加 `en.ts`/`zh.ts`。
- 中英文插值变量名称完全一致。
- 英文使用 sentence case，品牌名（Aliyun OSS、Qiniu、S3、WebP）保持官方大小写。
- 用户文案使用“vault/仓库”等已统一术语，不泄露内部 G/OSS 阶段编号。
- 结构化 Provider 错误在 i18n 层映射为配置、认证、权限、bucket、限流、网络、解析或服务问题。

## 自定义引用模板 UI

设置页使用与运行时相同的结构验证器：

- 空白表示关闭。
- 缺少 `{fileUrl}` 或存在未知变量时即时提示。
- 允许保存草稿，运行时仍安全 fallback。
- 不验证用户编写的 HTML/Markdown/CSS 语法。
- 变量清单和中英文帮助文案必须与 runtime renderer 同步。
