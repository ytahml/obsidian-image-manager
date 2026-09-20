# 设置、Modal 与国际化

## 设置模型与默认值

`ImageManagerSettings` 的持久化字段：

| 字段 | 默认值 | 业务作用 |
| --- | --- | --- |
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
| `localImageBrowserSort` | 名称/升序 | 本地浏览器的字段与方向偏好 |
| `remoteImageBrowserSort` | 名称（key）/升序 | 所有图床共享的远程浏览器字段与方向偏好 |
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
| `managedAutoUploadOnPaste` | false | managed 粘贴后自动上传 |
| `delegatedAutoUploadOnPaste` | false | delegated 粘贴后接力上传 |
| `managedKeepLocalCopy` | false | managed 自动上传后是否保留本地文件 |
| `delegatedKeepLocalCopy` | false | delegated 自动上传后是否保留本地文件 |
| `remoteDeleteHistory` | `[]` | 最近 200 条脱敏诊断 |

加载设置使用 `Object.assign({}, DEFAULT_SETTINGS, loaded)` 兼容旧 data，不能修改默认值对象；新增字段必须提供默认值和必要规范化。浏览器排序偏好只接受支持的字段与 `asc`/`desc`，缺失或无效值回退为名称/升序。

## 本地管理与图床接力

`localManagementMode` 只决定自动 paste/drop 的本地管理权。managed/delegated 分别保存自动上传和本地副本偏好，切换线路只改变当前读取哪组偏好，不重置任一组值。旧 `autoUploadOnPaste` / `keepLocalCopy` 加载时分别复制到两条线路，然后不再持久化旧字段。

`managedPasteReferenceFormat` 只影响 managed 初始引用，`reorganizeConvertFormat` 只影响显式整理。手动上传与自动上传均不受这两个格式设置门控。

Obsidian 1.13 声明式设置页在 delegated 下隐藏命名、命名提示、managed 引用格式和本地粘贴压缩，同时保留其值。路径模板与路径基准始终显示，因为显式整理和外部重命名修复在两种模式下都会读取。图床接力设置继续可编辑，并绑定当前模式自己的自动上传与本地副本偏好。

切换到 delegated 后，设置页在模式选择器下方显示兼容性提示：自动接力只面向 Markdown 编辑器，依赖 Obsidian 公开事件和可唯一解析的新增引用，属于尽力协调；不保证 Canvas 或特定第三方插件、版本、配置组合兼容，并保留显式上传命令作为替代路径。

## Obsidian 1.13 声明式设置

`minAppVersion` 为 1.13.0，不再兼容旧 imperative 设置 API：

- `getSettingDefinitions()` 是唯一设置入口，提供渲染与搜索索引；不实现 `display()` fallback。
- 普通单字段设置优先使用 `control` 自动绑定；需要副作用、即时草稿校验或动态复杂 UI 时使用 `setControlValue()` 或 `render`。
- 语言、本地管理模式和图床列表变化后调用 `update()`，重新生成本地化文案、禁用状态或动态列表结构。
- delegated 模式不生成 managed 专属控件；隐藏只影响设置页投影，不删除、重置或迁移其持久化值。
- 自动上传关闭时禁用“保留本地副本”；切换线路后根据该线路保存的偏好重新渲染。

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
| --- | --- |
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
- 本地与远程网格采用相同列宽规则：常规最小列宽 170px、间距 12px，在标准宽屏 Modal 中每排 5 张；视口不超过 600px 时最小列宽 140px、间距 8px，随可用宽度自动减少列数，不强制窄屏挤入 5 列。
- 切页与关闭要释放 observer/URL/session，并隔离迟到任务。

状态与选择语义保持一致：

- 本地与远程浏览器分别记忆最后的排序字段与方向；远程偏好不按图床隔离。
- 方向按钮显示当前升序或降序，并提供同样本地化的 `aria-label`；排序只重排当前内存结果，不触发扫描或远程 list 请求。
- 两页都提供“选择当前结果”和“清空选择”；前者只作用于当前搜索/筛选结果中的可删除项，后者清空全部选择。
- 普通卡片单击切换当前项选中/取消；Ctrl/Cmd + 单击同样切换当前项选中/取消，不清除其他可见或隐藏选择。选择资格不变，不可选项不会进入待删除集合。macOS 使用 Cmd；原生 Ctrl + 点击可能被宿主转为 `contextmenu`，不强制劫持系统右键语义。
- 双击卡片只预览：原生第二次 click 撤销首击实际改变的各项选择（含 Shift 区间）并恢复锚点，随后 dblclick 打开预览。无需延迟普通单击，也不会留下跨搜索重绘/切页的待执行定时器；复选框/标签、预览按钮和远程重试按钮隔离 click/dblclick 冒泡。
- 搜索结果更新时清除 Shift 选择锚点（包括防抖期间重新建立的锚点），但保留已选项；下一次 Shift 卡片或复选框操作在没有锚点时只作用于当前项。
- Shift + 单击卡片或复选框，按当前完整结果顺序选中/取消锚点到目标间的可选项：目标未选时选中区间，已选时取消区间，区间外选择保留；Ctrl/Cmd + Shift 只追加区间。移动端可单击选中/取消，也可用复选框操作或独立预览按钮打开预览，不依赖修饰键或双击。
- 原生预览按钮支持键盘；远程缩略图区保留 Enter/空格预览并忽略 IME 和子控件冒泡的 keydown。焦点样式覆盖预览按钮、远程缩略图区和复选框。
- 本地与远程预览按钮共用 `.image-browser-card-preview`：按内容宽度布局、最大宽度不超过卡片、水平 margin 为 0，与卡片内容左边缘对齐，上间距统一为 8px；通过 `align-self: flex-start` 覆盖本地父卡片的居中对齐，不依赖父卡片是 flex 还是普通块布局。
- 选择工具栏在窄屏允许摘要独占一行、按钮换行，并保持原生键盘焦点与禁用状态。
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
- `ConfirmDialog` 的取消按钮、Escape 和关闭叉号都属于未确认关闭，必须恰好调用一次 `onCancel`；确认已经开始后关闭不得再投影为取消。
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
