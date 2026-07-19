# 粘贴/拖放处理

## 文件：`src/main.ts`（事件注册、粘贴/拖放处理与自动上传）

## 事件注册

```typescript
// editor-paste
this.registerEvent(
    this.app.workspace.on('editor-paste', (evt, editor, info) => {
        if (evt.defaultPrevented) return;       // ① 检查是否已处理
        const handled = this.handleImagePaste(evt, editor, info.file);
        if (handled) evt.preventDefault();      // ② 处理成功则阻止默认行为
    })
);

// editor-drop
this.registerEvent(
    this.app.workspace.on('editor-drop', (evt, editor, info) => {
        if (evt.defaultPrevented) return;
        const handled = this.handleImageDrop(evt, editor, info.file);
        if (handled) evt.preventDefault();
    })
);
```

**关键**：处理器返回 `boolean`，由注册处调用 `evt.preventDefault()`（ESLint `obsidianmd/editor-drop-paste` 规则要求）。

## 处理流程

```
handleImagePaste/handleImageDrop
  → 检查 evt.clipboardData/evt.dataTransfer 中的文件
  → 过滤 image/* 类型
  → processImageFiles（逐文件处理）
    → mimeToExt（MIME → 扩展名）
    → generateFileName（模板变量替换）
    → 可选 ImageNamePromptModal（promptImageName=true）
    → savePastedImage
```

## 文件名生成：`generateFileName`

模板变量（`imageNamingTemplate` 设置）：

| 变量 | 示例 | 说明 |
|------|------|------|
| `{noteName}` | `my-note` | 当前笔记名（不含扩展名） |
| `{date}` | `2026-06-07` | 当前日期 |
| `{time}` | `143025` | 当前时间（HHmmss） |
| `{timestamp}` | `1749287425000` | 毫秒时间戳 |
| `{year}` | `2026` | 年 |
| `{month}` | `06` | 月（补零） |
| `{day}` | `07` | 日（补零） |
| `{counter}` | `0`, `1`, `2`... | 会话内自增计数器 |

默认模板：`image-{timestamp}`

### 文件名清理：`sanitizeFileName`

1. 去除用户输入的扩展名
2. 空格 → 连字符
3. 移除 `/\:*?"<>|` 等不安全字符
4. 合并连续连字符
5. 去除首尾连字符
6. 空文件名 → `image`

## 图片保存：`savePastedImage`

### 1. 路径解析：`resolveImagePath`

模板变量（`imagePathTemplate` 设置）：

| 变量 | 示例 | 说明 |
|------|------|------|
| `{noteName}` | `my-note` | 当前笔记名（不含扩展名） |
| `{notePath}` | `notes/blog` | 当前笔记目录 |
| `{filename}` | `image-1749287425000.png` | 生成的文件名 |
| `{year}` | `2026` | 年 |
| `{month}` | `06` | 月 |
| `{day}` | `07` | 日 |
| `{timestamp}` | `1749287425` | 秒级时间戳 |

**路径基准**（`imagePathBase` 设置）：
- `vault`：相对于 vault 根目录
- `note`：相对于笔记所在目录

### 2. 目录创建

递归创建中间目录：
```typescript
const parts = dir.split('/');
let current = '';
for (const part of parts) {
    current = current ? `${current}/${part}` : part;
    if (!vault.getAbstractFileByPath(current)) {
        await vault.createFolder(current).catch(() => {});
    }
}
```

### 3. 文件名冲突处理：`ensureUniquePath`

```typescript
// 检查 vault 内存映射 + 文件系统
while (vault.getAbstractFileByPath(filePath) || await vault.adapter.exists(filePath)) {
    filePath = `${baseName}-${counter}.${ext}`;
    counter++;
}
```

**竞态条件处理**：如果 `createBinary` 失败（并发冲突），用时间戳重试：
```typescript
const ts = Date.now();
const retryName = `${filename.replace(/\.[^.]+$/, '')}-${ts}.${ext}`;
```

### 4. 可选压缩

条件：`autoCompress=true` 且扩展名不是 `svg`

流程：
1. `Blob` → `Image`（`URL.createObjectURL`）
2. `Canvas` 绘制
3. PNG → WebP（更好的压缩率），其他格式保持原格式
4. `canvas.toBlob(mimeType, quality)`
5. `URL.revokeObjectURL` 释放内存

### 5. 引用插入

```typescript
if (reorganizeConvertFormat) {
    // Markdown 格式：![name](relative/path)
    const relativePath = computeRelativePath(noteDir, savedFile.path);
    ref = `![${savedFile.name}](${encodePathSegments(relativePath)})`;
} else {
    // Wiki 格式：![[filename]]
    ref = `![[${savedFile.name}]]`;
}
editor.replaceSelection(ref);
```

`encodePathSegments` 逐段处理本地路径：保留 Unicode 和 RFC 3986 `pchar` 安全 ASCII（排除会影响 Markdown 的括号），编码其余 ASCII，包括空白、控制字符、`%`、`#`、`?`、括号、方括号、引号、尖括号、反斜杠、反引号、花括号和竖线。粘贴、图片预览插入、引用转换、图片整理和批量重命名统一使用该规则，这样上传失败保留本地引用或其他流程生成引用时，不会被 Markdown 或 URL 语义误解析。

### 6. 可选自动上传

条件：`autoUploadOnPaste=true` 且 `reorganizeConvertFormat=true`

流程：
1. 获取默认图床配置（`getDefaultHostingConfig`）
2. 使用全局上传路径模板创建上传器
3. 上传数据并传入 `savedFile.path`，供 `{sourceDir}` 解析
4. 替换刚插入的本地引用为远程 URL
5. 更新其他笔记中的本地引用；跳过已由 Editor 更新的当前笔记，并忽略所有带 URL scheme 或 `//` 的远程引用
6. 可选删除本地文件（`!keepLocalCopy`）
7. 仅当图片的直接父目录仍是保存时捕获的同一 `TFolder`、不是 Vault 根目录且当前为空时，永久、非递归删除该目录；清理失败不改变上传成功状态

## 相关设置

| 设置 | 默认值 | 影响 |
|------|--------|------|
| `imageNamingTemplate` | `image-{timestamp}` | 文件名模板 |
| `promptImageName` | `false` | 是否弹窗让用户输入名称 |
| `imagePathTemplate` | `attachments` | 存储路径模板 |
| `imagePathBase` | `note` | 路径基准（vault/note） |
| `reorganizeConvertFormat` | `true` | 引用格式（MD/Wiki） |
| `autoCompress` | `false` | 是否自动压缩 |
| `compressQuality` | `80` | 压缩质量 |
| `autoUploadOnPaste` | `false` | 是否自动上传 |
| `keepLocalCopy` | `false` | 上传后是否保留本地 |

## MIME → 扩展名映射：`mimeToExt`

```typescript
'image/png'     → 'png'
'image/jpeg'    → 'jpg'
'image/gif'     → 'gif'
'image/webp'    → 'webp'
'image/bmp'     → 'bmp'
'image/svg+xml' → 'svg'
'image/tiff'    → 'tiff'
'image/avif'    → 'avif'
```

## 已知问题

### 竞态条件（已处理）

`ensureUniquePath` 检查的是 vault 内存映射，但 `createBinary` 检查文件系统。在并发粘贴时可能冲突。解决方案：失败后用时间戳重试。

### IME 回车触发表单提交（1.0.1 已修复）

`ImageNamePromptModal` 中 keydown 事件未检查 `e.isComposing`，导致中文输入法按回车确认选字时触发表单提交。修复：添加 `if (e.isComposing) return;`。
