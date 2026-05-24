# Obsidian Image Manager 插件使用手册

## 简介

Image Manager 是一款功能强大的 Obsidian 图片管理插件，提供图片浏览、压缩优化、图床上传、引用格式转换、孤立图片清理等功能。支持中英文双语界面。

- **插件 ID**: `obsidian-image-manager`
- **版本**: 1.0.0
- **最低 Obsidian 版本**: 1.4.0
- **支持平台**: 桌面端 + 移动端

---

## 功能概览

| 功能 | 说明 |
|------|------|
| 粘贴/拖放图片 | 自动命名、自定义存储路径、自动压缩、使用配置的引用格式 |
| 图片浏览器 | 缩略图网格浏览全库图片，点击即插入 |
| 图片压缩 | 基于 Canvas API 的本地压缩，零外部依赖 |
| 图床上传 | 支持 SM.MS、阿里云 OSS、七牛云、S3 兼容存储、自定义 API |
| 批量上传 | 一键上传全库图片到图床 |
| 引用格式转换 | Wiki (`![[img.png]]`) 与 Markdown (`![alt](img.png)`) 互转 |
| 孤立图片清理 | 查找并删除未被任何笔记引用的图片 |
| 图片重命名 | 重命名图片文件并自动更新所有笔记中的引用 |

---

## 安装

1. 将插件文件夹（含 `main.js`、`manifest.json`、`styles.css`）复制到 Vault 的 `.obsidian/plugins/obsidian-image-manager/` 目录
2. 在 Obsidian 设置 → 第三方插件中启用 "Image Manager"

---

## 设置说明

打开 Obsidian 设置 → Image Manager Settings 进入插件设置面板。

### 语言 (Language)

切换插件界面语言，支持 **English** 和 **中文**，切换后立即生效。

### 通用设置 (General)

#### 图片存储路径模板 (Image path template)

定义粘贴/拖放图片时的存储目录。支持变量插值，可实现灵活的存储规则。

**可用变量：**

| 变量 | 说明 | 示例 |
|------|------|------|
| `{noteName}` | 当前笔记名（不含扩展名） | `daily-note` |
| `{notePath}` | 当前笔记所在目录 | `journal/2026` |
| `{year}` | 当前年份（4 位） | `2026` |
| `{month}` | 当前月份（2 位，补零） | `05` |
| `{day}` | 当前日期（2 位，补零） | `24` |
| `{filename}` | 图片文件名（含扩展名） | `image-2026-05-24-a3f2.png` |
| `{timestamp}` | Unix 时间戳（秒） | `1748103025` |

**配置示例：**

| 模板值 | 效果 |
|--------|------|
| `attachments` | 图片存到 `attachments/` 目录（默认） |
| `{noteName}` | 图片存到与笔记同名的目录，如 `daily-note/` |
| `assets/{noteName}` | 图片存到 `assets/daily-note/` |
| `{notePath}/{noteName}` | 图片存到笔记所在目录下的同名子目录 |
| `images/{year}/{month}` | 按年月分目录，如 `images/2026/05/` |

**注意事项：**
- 当没有活动编辑器时（如从命令面板调用），`{noteName}` 和 `{notePath}` 解析为空，路径自动退化。例如 `assets/{noteName}` 退化为 `assets`
- 中间的目录层级会自动创建
- 如果文件名冲突，自动追加 `-1`、`-2` 等后缀

#### 路径基准 (Path base)

控制路径模板相对于哪个基准目录解析：

- **相对于库根目录 (Relative to vault root)**：路径模板直接从仓库根目录开始。模板 `attachments` → 图片存到 `<库>/attachments/`
- **相对于文章所在目录 (Relative to current note)**：路径模板从当前笔记所在目录开始（默认）。模板 `attachments` → 图片存到 `<笔记所在目录>/attachments/`

**示例对比：**

假设笔记位于 `journal/2026/daily-note.md`，路径模板为 `attachments`：

| 路径基准 | 图片存储位置 |
|----------|-------------|
| 相对于库根目录 | `attachments/image.png` |
| 相对于文章所在目录 | `journal/2026/attachments/image.png` |

假设路径模板为 `{noteName}`：

| 路径基准 | 图片存储位置 |
|----------|-------------|
| 相对于库根目录 | `daily-note/image.png` |
| 相对于文章所在目录 | `journal/2026/daily-note/image.png` |

#### 引用格式 (Reference format)

选择插入图片引用时使用的格式：

- **Obsidian Wiki**: `![[image.png]]`
- **标准 Markdown**: `![image.png](attachments/image.png)`

选择 Markdown 格式时，路径中的特殊字符（如空格）会自动进行 URL 编码。

---

### 图片命名 (Image Naming)

#### 命名模板 (Naming template)

定义粘贴/拖放图片时的文件名生成规则。

**可用变量：**

| 变量 | 说明 | 示例 |
|------|------|------|
| `{date}` | 当前日期 (YYYY-MM-DD) | `2026-05-24` |
| `{time}` | 当前时间 (HHmmss) | `143025` |
| `{timestamp}` | Unix 时间戳（毫秒） | `1748103025000` |
| `{random}` | 4 位随机字母数字 | `a3f2` |
| `{counter}` | 递增计数器（会话内从 0 开始） | `0`, `1`, `2` |
| `{year}` | 4 位年份 | `2026` |
| `{month}` | 2 位月份 | `05` |
| `{day}` | 2 位日期 | `24` |

**配置示例：**

| 模板值 | 生成的文件名 |
|--------|-------------|
| `image-{date}-{random}` | `image-2026-05-24-a3f2.png`（默认） |
| `{noteName}-{counter}` | `daily-note-0.png` |
| `img-{timestamp}` | `img-1748103025000.png` |
| `{year}{month}{day}-{random}` | `20260524-a3f2.png` |

**文件名清理规则：**
- 空格自动替换为连字符 `-`
- 不安全字符 (`/\:*?"<>|`) 自动移除
- 连续连字符合并为一个
- 首尾连字符移除
- 结果为空时回退为 `image`
- 扩展名自动追加

#### 提示输入图片名称 (Prompt for image name)

开启后，每次粘贴/拖放图片时会弹出输入框，允许手动指定图片名称。输入框预填自动生成的名称，留空则使用默认名称。支持 Enter 确认、Escape 取消。

---

### 压缩设置 (Compression)

#### 自动压缩 (Auto compress)

开启后，粘贴/拖放图片时自动进行压缩（SVG 格式除外）。

**压缩特性：**
- 基于浏览器 Canvas API，无需外部依赖
- PNG 图片自动转换为 WebP 格式以获得更好的压缩率
- 压缩在本地完成，不上传到任何服务

#### 压缩质量 (Compress quality)

压缩质量等级，范围 1-100。数值越小压缩率越高，但图片质量越低。推荐值 70-85。

---

### 画廊设置 (Gallery)

#### 缩略图大小 (Thumbnail size)

图片浏览器中缩略图的显示大小，范围 80-400 像素。

---

### 图床设置 (Image Hosting)

#### 添加图床

点击 `+` 按钮添加图床服务商配置。支持以下 5 种图床：

##### 1. SM.MS（免费图床）

| 字段 | 说明 |
|------|------|
| Token（可选） | 从 sm.ms/home/profile/apitoken 获取 |

无需额外配置即可使用，有 Token 可避免上传限制。

##### 2. 阿里云 OSS

| 字段 | 说明 |
|------|------|
| Region | 区域，如 `oss-cn-hangzhou` |
| Access Key ID | 访问密钥 ID |
| Access Key Secret | 访问密钥 Secret（密码字段） |
| Bucket | 存储桶名称 |

##### 3. 七牛云

| 字段 | 说明 |
|------|------|
| Access Key | 访问密钥 |
| Secret Key | 密钥 Secret（密码字段） |
| Bucket | 存储空间名称 |
| Domain | 访问域名，如 `https://img.example.com` |

##### 4. S3 兼容存储

适用于 AWS S3、MinIO、Cloudflare R2 等 S3 兼容服务。

| 字段 | 说明 |
|------|------|
| Endpoint | 服务端点，如 `https://s3.amazonaws.com` |
| Region | 区域 |
| Access Key ID | 访问密钥 ID |
| Secret Access Key | 密钥 Secret（密码字段） |
| Bucket | 存储桶名称 |
| Force Path Style | 使用 path-style URL（如 MinIO） |

##### 5. 自定义 API

| 字段 | 说明 |
|------|------|
| Upload URL | 上传接口地址 |
| Method | 请求方法：POST 或 PUT |
| Headers | 自定义 HTTP 头（JSON 格式） |
| File Field Name | 文件字段名，如 `file` |
| JSON Path | 响应 JSON 中 URL 的路径，如 `data.url` |
| Extra Body | 额外表单字段（JSON 格式） |

**图床通用字段：**
- **Name** — 显示名称
- **Enabled** — 是否启用
- **Upload Path** — 上传路径模板（留空则使用全局模板）
- **URL Prefix** — 自定义域名前缀，如 `https://img.example.com`

#### 上传路径模板 (Upload path template)

全局上传路径模板，适用于所有图床。

**可用变量：**

| 变量 | 说明 | 示例 |
|------|------|------|
| `{year}` | 4 位年份 | `2026` |
| `{month}` | 2 位月份 | `05` |
| `{day}` | 2 位日期 | `24` |
| `{filename}` | 文件名（不含扩展名） | `image-2026-05-24` |
| `{ext}` | 文件扩展名 | `png` |
| `{timestamp}` | Unix 时间戳（秒） | `1748103025` |

**默认值：** `images/{year}/{month}/{hash}.{ext}`

#### 上传后自动替换 (Auto replace after upload)

开启后，上传成功自动将笔记中的本地图片引用替换为图床 URL。

---

## 命令列表

通过命令面板 (`Ctrl/Cmd + P`) 调用以下命令：

| 命令 | 说明 |
|------|------|
| **Browse images** | 打开图片浏览器，以缩略图网格浏览全库图片 |
| **Compress current image** | 压缩当前打开的图片文件（需先在编辑器中打开图片） |
| **Convert reference format (current note)** | 转换当前笔记中的图片引用格式（自动检测并转为另一种） |
| **Convert reference format (entire vault)** | 转换整个仓库中所有笔记的图片引用格式 |
| **Upload image to hosting** | 将当前图片上传到图床，URL 自动复制到剪贴板 |
| **Batch upload all images** | 批量上传仓库中所有图片到指定图床 |
| **Find orphan images** | 查找未被任何笔记引用的孤立图片 |
| **Rename image (update references)** | 重命名图片文件并自动更新所有笔记中的引用 |
| **Reorganize images** | 根据路径规则整理当前笔记引用的图片资源 |

---

## 功能详解

### 图片浏览器

点击侧边栏的图片图标或使用命令 "Browse images" 打开。

- **搜索**：输入关键词实时过滤（300ms 防抖）
- **排序**：按名称、大小、修改时间、创建时间排序
- **插入**：点击缩略图，自动将图片引用插入当前编辑器光标位置
- **计数**：底部显示 "显示 X / Y 张图片"

### 图片压缩

**粘贴时自动压缩：**
- 在设置中开启 "Auto compress"
- 粘贴/拖放图片时自动压缩后保存
- PNG 自动转 WebP 格式以获得更高压缩率

**手动压缩：**
- 在编辑器中打开一张图片文件
- 运行命令 "Compress current image"
- 显示压缩率，如 "图片已压缩，节省 35%"

### 引用格式转换

**当前笔记转换：**
- 自动检测笔记中主要使用的格式（Wiki 或 Markdown）
- 将所有图片引用转换为另一种格式
- 保留 alt 文本

**全库转换：**
- 扫描所有 Markdown 文件
- 将图片引用转换为设置中配置的格式的反向格式

### 孤立图片清理

- 扫描仓库中所有图片文件
- 对比所有 Markdown 文件中的图片引用
- 列出未被任何笔记引用的图片
- 支持全选/取消全选
- 显示孤立图片总大小
- 确认后批量删除

### 图片重命名

- 仅在编辑器中打开图片文件时可用
- 输入新名称，自动更新所有笔记中的引用
- 支持 Wiki 和 Markdown 两种引用格式的更新
- 显示更新了多少个笔记

### 图片资源整理

根据插件配置的路径规则（路径模板 + 路径基准），自动将笔记引用的图片文件移动到正确位置，并更新引用路径。

**使用方式：**
- **右键笔记文件** → 选择 "整理图片资源" → 整理该笔记引用的所有图片
- **右键文件夹** → 选择 "整理图片资源" → 整理文件夹内所有笔记引用的图片
- **命令面板** → "Reorganize images" → 整理当前打开的笔记

**处理逻辑：**
1. 解析笔记中的所有图片引用（Wiki 和 Markdown 格式）
2. 对每个本地图片引用（跳过外部 URL）：
   - 查找图片文件（先按路径匹配，再按文件名匹配）
   - 根据路径模板计算目标目录
   - 若已在正确位置 → 跳过
   - 否则 → 移动文件到目标目录 + 更新引用路径
3. 同步更新其他笔记中引用同一图片的路径

**示例：**

假设笔记 `journal/daily.md` 引用了 `old-folder/screenshot.png`，路径模板为 `{noteName}`，路径基准为相对于文章所在目录：

- 目标位置：`journal/daily/screenshot.png`
- 插件自动将图片移动到该位置，并将笔记中的引用更新为新路径

### 图床上传

**单张上传：**
- 打开图片文件，运行 "Upload image to hosting"
- 如有多个图床，弹出选择框
- 上传成功后 URL 自动复制到剪贴板
- 若开启 "自动替换"，笔记中的本地引用自动替换为图床 URL

**批量上传：**
- 运行 "Batch upload all images"
- 选择目标图床
- 并发上传（3 个并发），失败自动重试（最多 3 次）
- 显示上传进度和最终结果

### 粘贴/拖放图片处理流程

1. 插件拦截粘贴/拖放事件中的图片文件
2. 根据命名模板生成文件名（或弹出命名提示框）
3. 清理文件名中的不安全字符
4. 根据路径模板确定存储目录
5. 处理文件名冲突（自动追加数字后缀）
6. 如开启自动压缩则进行压缩
7. 保存到仓库
8. 在编辑器中插入图片引用（使用配置的格式）

---

## 快捷操作

| 操作 | 方式 |
|------|------|
| 打开图片浏览器 | 侧边栏图片图标 / 命令面板 |
| 粘贴图片 | `Ctrl/Cmd + V`（自动拦截处理） |
| 拖放图片 | 从文件管理器拖入编辑器 |
| 调用命令 | `Ctrl/Cmd + P` 输入命令名 |

---

## 常见问题

**Q: 粘贴的图片文件名有空格导致 Markdown 无法显示？**
A: 插件已自动将空格替换为连字符，并对 Markdown 引用中的路径进行 URL 编码。

**Q: 如何让每篇文章的图片存到独立目录？**
A: 将路径模板设置为 `{noteName}`，图片会存到与笔记同名的子目录中。

**Q: 切换引用格式后，已有的引用会自动更新吗？**
A: 不会自动更新。需要手动运行 "Convert reference format" 命令进行批量转换。

**Q: 压缩后的图片质量不满意怎么办？**
A: 调高压缩质量数值（推荐 75-85），或对特定图片关闭自动压缩后手动压缩。

**Q: 图床上传失败怎么办？**
A: 检查图床配置中的密钥是否正确，网络是否通畅。批量上传会自动重试 3 次。
