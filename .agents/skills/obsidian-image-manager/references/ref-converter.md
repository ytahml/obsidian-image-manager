# 引用格式转换

## 文件：`src/utils/ref-converter.ts`

## 两种引用格式

| 格式 | 语法 | 示例 |
|------|------|------|
| Markdown | `![alt](path)` | `![photo](assets/img.png)` |
| Wiki | `![[path\|alt]]` | `![[img.png\|photo]]` |

## 正则定义（`src/constants.ts`）

```typescript
MD_IMAGE_REGEX = /!\[([^\]]*)\]\(([^)]+)\)/g
// 匹配组：[1] = altText, [2] = path

WIKI_IMAGE_REGEX = /!\[\[([^\]|]+)(?:\|([^\]]*))?\]\]/g
// 匹配组：[1] = path, [2] = altText（可选）
```

**注意**：正则使用 `g` 标志，使用前需重置 `lastIndex = 0`。

## RefConverter 类

### 核心方法

```typescript
class RefConverter {
    // 解析文本中所有图片引用
    parseReferences(text: string): ImageReference[];

    // 转换单个引用
    convertReference(ref: ImageReference, targetFormat: ReferenceFormat, noteFile?: TFile): string;

    // 转换文本中所有引用（反向遍历保持索引）
    convertAllReferences(text: string, targetFormat: ReferenceFormat, noteFile?: TFile): string;

    // 统计引用数量
    countReferences(text: string): { markdown: number; wiki: number };
}
```

### parseReferences 流程

1. 重置两个正则的 `lastIndex`
2. 遍历 MD_IMAGE_REGEX 匹配 → 构建 `ImageReference`（format: 'markdown'）
3. 遍历 WIKI_IMAGE_REGEX 匹配 → 构建 `ImageReference`（format: 'wiki'）
4. 按 `col`（字符索引）排序
5. 返回引用数组

### convertReference 流程

**Wiki → Markdown**：
1. 如果路径不含 `/`，在 vault 中查找完整路径（`resolveImagePath`）
2. 计算相对于笔记目录的相对路径（`computeRelativePath`）
3. URL 编码路径段（`encodePathSegments`）
4. 生成 `![altText](relativePath)`

**Markdown → Wiki**：
1. 提取文件名（去掉目录部分）
2. 生成 `![[filename|altText]]` 或 `![[filename]]`

### convertAllReferences 流程

1. `parseReferences` 获取所有引用
2. **反向遍历**（从最后一个到第一个）→ 保持字符索引正确
3. 逐个调用 `convertReference`
4. 用 `substring` 替换原文

### computeRelativePath

计算从 `fromDir` 到 `toPath` 的相对路径：
```
fromDir = "notes/blog"
toPath  = "assets/images/photo.png"
result  = "../../assets/images/photo.png"
```

**注意**：此方法为 public，可被 `ImageReorganizer` 和 `BatchRename` 调用。

### resolveImagePath（私有）

通过文件名在 vault 中查找图片文件的完整路径：
```typescript
const match = files.find((f) => f.name === filename);
return match?.path ?? null;
```

## 路径编码：`encodePathSegments`

按路径段编码会影响 Markdown 或 URL 解析的 ASCII，包括空白、控制字符、`%`、`#`、`?`、括号、方括号、引号、尖括号、反斜杠、反引号、花括号和竖线。

**不编码**：Unicode，以及 RFC 3986 `pchar` 中安全的 ASCII（括号除外），例如字母、数字、`-._~`、`+`、`&`、`=`、`@`。

解析已有 Markdown 引用时，`decodePathSegments` 逐段还原合法百分号编码，并让包含无效 `%` 转义的其他路径段继续可用。批量重命名先还原逻辑路径再重新编码，避免 `%20` 被重复编码为 `%2520`。

## 关键设计决策

1. **反向遍历**：替换引用时从后往前处理，避免前面的替换影响后面的字符索引
2. **路径解析优先级**：先尝试精确路径匹配，再按文件名全局搜索
3. **alt 文本处理**：如果 alt 文本等于文件名（不含扩展名），则省略 alt 部分
4. **lastIndex 重置**：带 `g` 标志的正则每次使用前必须重置

## 使用场景

| 场景 | 调用方法 | 说明 |
|------|----------|------|
| 转换当前笔记 | `convertAllReferences(content, 'markdown', file)` | Wiki → MD |
| 转换整个 vault | 遍历所有 MD 文件逐个调用 | 批量转换 |
| 解析引用 | `parseReferences(content)` | 上传、整理、重命名 |
| 统计引用 | `countReferences(content)` | 显示提示信息 |
| 远程引用索引 | `parseReferences(text)` | G2 将标准 Markdown 远程图片识别为明确引用；HTML、frontmatter、普通链接和裸 URL 由独立扫描器保守标记为可能引用 |
