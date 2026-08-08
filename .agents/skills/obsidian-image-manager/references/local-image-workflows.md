# 本地图片与引用工作流

## 粘贴与拖放

事件注册必须先检查 `evt.defaultPrevented`。业务处理器只判断是否接管并返回 boolean，由注册处调用 `preventDefault()`，以满足 Obsidian editor paste/drop 规则。

流程：

```text
ClipboardEvent/DragEvent
  → 过滤 image/* 文件
  → generateImageFileName
  → 可选 ImageNamePromptModal
  → savePastedImage
      → resolveImagePath
      → ensureDirectory / ensureUniquePath
      → 可选压缩
      → vault.createBinary
      → 插入 Markdown 或 Wiki 引用
      → 可选 autoUploadAfterPaste
```

### 命名模板

`imageNamingTemplate` 支持：

| 变量 | 语义 |
|---|---|
| `{noteName}` | 当前笔记 basename；没有笔记或清理后为空时回退 |
| `{date}` | `YYYY-MM-DD` |
| `{time}` | `HHmmss` |
| `{timestamp}` | 毫秒时间戳 |
| `{year}` `{month}` `{day}` | 日期分量 |
| `{counter}` | 插件会话内计数 |

清理规则移除用户扩展名、替换空格、去除 `/\:*?"<>|` 等不安全字符、合并连字符并清理首尾；空结果回退 `image`。命名 Modal 的 Enter 必须处理 IME composing。

### 本地路径模板

`imagePathTemplate` 支持 `{noteName}`、`{notePath}`、`{filename}`、`{year}`、`{month}`、`{day}`、`{timestamp}`。

- `imagePathBase=vault`：相对 Vault 根。
- `imagePathBase=note`：相对当前笔记目录。
- 递归创建中间目录。
- 同名文件使用 `-1`、`-2` 等后缀；并发创建冲突时用时间戳重试。
- Markdown 引用应相对当前笔记，Wiki 引用使用文件名。

## Markdown 路径编码

`encodePathSegments` 逐段编码会改变 Markdown 或 URL 解析的 ASCII：空白、控制字符、`% # ? ( ) [ ] " < > \ ^ ` { | }`。

保留：

- `/` 路径分隔符
- Unicode
- RFC 3986 path 中安全的 ASCII，例如字母数字、`-._~!$&'*+,;=:@`

`decodePathSegments` 逐段容错解码已有本地引用；无效 `%` 转义不得使整个路径解析失败。上传 URL 展示使用独立 `makePublicUrlReadable`：只还原 path 中合法的非 ASCII UTF-8，query、fragment 和敏感 ASCII 编码保持不变。

## 引用解析与转换

`RefConverter` 处理：

- Markdown：`![alt](path)`
- Wiki：`![[path|alt]]`

核心约束：

- 全局正则每次解析前重置 `lastIndex`。
- 合并两类引用后按字符位置排序并记录零基 line/col。
- 批量替换从后往前，避免前一处替换改变后续 offset。
- Wiki → Markdown 时按文件名解析 Vault 路径，并依据当前笔记计算相对路径。
- Markdown → Wiki 的内部转换器只保留文件名；当前用户命令只公开 Wiki → Markdown。
- alt 等于文件 basename 时避免生成冗余 Wiki alt；Markdown 输出保留可理解的 alt。

远程引用索引不只依赖 `RefConverter`；它还有独立 URL 扫描能力，详见远程文档。

## Canvas 压缩与格式

`ImageOptimizer` 提供 `compressImage`、`convertFormat`、`getImageInfo`：

- SVG 压缩直接返回原数据；格式转换拒绝 SVG。
- PNG 压缩输出 WebP；其他格式按 MIME 输出。
- JPG 不支持透明度，转换时将 alpha 混合到白色背景。
- GIF 经 Canvas 只保留第一帧，不能无提示把动画处理宣传为无损。
- quality 设置为 1–100，调用 Canvas 时除以 100。
- 使用 `createEl('canvas')`，加载后释放 object URL。
- 大图受宿主内存限制，调用方必须捕获失败。

自定义引用模板未请求宽高时不得读取图片尺寸；请求尺寸但无法得到正整数时，上传仍成功，引用回退 Markdown。

## 本地图片浏览器

`ImageBrowserModal` 是本地/图床共同外壳。本地页：

- 300ms 搜索防抖。
- 名称、大小、修改时间、创建时间排序。
- 全部/已引用/孤立引用状态筛选；扫描完成前禁用。
- 缩略图大小来自设置，点击打开 `ImagePreviewModal`。
- green/amber/gray 分别表达已引用、孤立、无法判断。
- 切换页签或关闭后通过 generation 隔离迟到扫描结果。

选择只允许当前明确孤立的卡片，并跨搜索、排序、筛选与重绘保留。少量结果按内容高度贴顶，不拉伸卡片。

### 本地预览

预览显示文件名、大小、尺寸和完整引用列表：

- 引用列表默认展开，仍可收起。
- 按笔记分组并列出全部行号。
- 点击行号关闭浏览器并定位笔记。
- 操作包括复制引用、插入当前笔记、上传、重命名和关闭。

复制与插入统一使用安全路径编码。

## 孤立图片与安全清理

`OrphanFinder` 扫描全部受支持图片和 Markdown 文件，将引用解析为 Vault 文件：

1. 绝对 `/path` 去根斜杠后规范化。
2. `./`、`../` 基于笔记目录。
3. 含 `/` 的路径先尝试 Vault 路径，再尝试相对路径。
4. 仅文件名先笔记目录、再 Vault 根、最后全局搜索。

本地删除资格不缓存：

1. 浏览器扫描只用于展示。
2. 用户确认前重新扫描并删除已不满足条件的选择。
3. 实际执行时再次扫描。
4. 仅把仍存在且仍在 `orphans` 中的 TFile 交给 `fileManager.trashFile()`。
5. 文件消失或新增引用报告 skipped；单项回收失败报告 failed，后续继续。

委托自动接力在刚替换活动编辑器的事务引用后，复扫来源笔记必须使用 Editor 当前文本覆盖可能尚未刷新的 Vault 缓存；否则旧本地引用会导致错误保留本应回收的附件。

专用 `OrphanImagesModal` 与图片浏览器共享这套 fresh 边界。

## 笔记图片上传与引用替换

`collectLocalNoteImages`：

- 活动笔记读取 Editor 内存文本，避免未保存内容丢失。
- 非活动笔记使用 Vault `read`。
- Markdown 本地路径先完整容错解码并去除尖括号，再用 Obsidian linkpath 语义解析。
- 聚合未解析引用、上传失败与异常，最终 Notice 显示成功/失败数及首个安全摘要。

上传后替换：

- 只匹配本地文件名或 Vault 路径。
- 跳过所有 URL scheme、protocol-relative、data 与 blob 引用。
- 当前 Editor 已更新时，遍历其他笔记必须跳过当前文件。
- 上传 URL 中 Unicode 可读化只发生在生成 Markdown 引用的边界。

## 自动上传与本地清理

`autoUploadOnPaste` 仅在 Markdown 模式生效：

1. 保存本地文件并插入引用。
2. 使用默认图床上传，传入 `savedFile.path` 支持 `{sourceDir}`。
3. 替换当前 Editor 中刚插入的引用。
4. 按设置替换其他笔记中的匹配本地引用。
5. `keepLocalCopy=false` 时用 `fileManager.trashFile()` 回收本地文件。
6. 只有保存时捕获的同一直接父 `TFolder` 仍存在、不是 Vault 根且当前为空时，才永久非递归删除该空目录。

空目录清理失败不能改变上传成功结果。

## 重命名与资源整理

### 重命名

`BatchRename.renameImage` 必须在 `vault.rename()` 前更新全库引用，防止 Obsidian 内置链接更新覆盖目录信息。新引用保留原目录和格式，alt 等于旧文件名时同步更新。

外部普通 rename 由 Vault event 在约 100ms 后调用 `fixBrokenImageRefs`：

- 重命名时恢复旧目录。
- 移动时使用新目录。
- `imagePathBase=note` 时重新计算相对路径。
- 整理期间 `isReorganizing=true`，跳过该修复，避免双重更新。

### 整理

`ImageReorganizer`：

- 反向遍历引用。
- 跳过远程 URL。
- 按 `skipWikiRefsOnReorganize` 决定 Wiki 是否参与。
- 根据路径模板和 base 计算目标，冲突时添加数字后缀。
- 移动或转换后更新当前笔记；有移动时更新其他笔记。
- `reorganizeConvertFormat=true` 时目标为 Markdown；false 时保持原格式。

不要把“使用 Wiki 粘贴”误解为支持用户命令 Markdown → Wiki。
