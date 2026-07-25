# 图片扫描与孤立检测

## 文件

- `src/utils/image-scanner.ts` — 图片文件扫描
- `src/utils/orphan-finder.ts` — 孤立图片检测
- `src/utils/local-orphan-management.ts` — 本地引用状态、fresh 选择校验与回收站删除

## ImageScanner

```typescript
class ImageScanner {
    constructor(app: App, supportedExtensions: string[]);

    // 获取所有图片
    getAllImages(): TFile[];

    // 判断是否为图片文件
    isImageFile(file: TFile): boolean;

    // 按 ImageFilter 统一过滤关键词、扩展名、大小和目录
    filterImages(images: TFile[], filter: ImageFilter): TFile[];

    // 排序
    sortImages(images: TFile[], sortBy: SortBy, order: SortOrder): TFile[];

    // 获取 MIME 类型
    getMimeType(file: TFile): string;
}
```

### 扫描逻辑

1. `vault.getFiles()` 获取所有文件
2. 按 `supportedExtensions` 过滤图片文件
3. 支持按关键词、扩展名、大小、目录筛选
4. 支持按名称、大小、修改时间、创建时间排序

### 排序方式

| SortBy | 说明 |
|--------|------|
| `name` | 文件名（字母顺序） |
| `size` | 文件大小 |
| `modified` | 修改时间 |
| `created` | 创建时间 |
| `reference-count` | 引用数量（需要 OrphanFinder） |

## OrphanFinder

```typescript
class OrphanFinder {
    constructor(app: App, supportedExtensions: string[]);

    // 查找孤立图片及统计
    findOrphans(): Promise<OrphanResult>;

    // 查找引用某图片的笔记与全部行号
    getReferencingNotes(file: TFile): Promise<Array<{ path: string; lines: number[] }>>;
}
```

`OrphanResult` 包含 `orphans: TFile[]`、`total` 和 `referenced`。

`local-orphan-management.ts` 不缓存删除资格。图片浏览器可把一次扫描用于展示，但确认前和实际执行时必须分别获取新的 `OrphanResult`；只有仍存在于最新 `orphans` 集合的选择才交给 `fileManager.trashFile()`。文件消失或新增引用的路径报告为 skipped，单项回收站失败报告为 failed，后续项目继续顺序处理。

### 孤立图片检测流程

```
1. 获取所有图片文件（ImageScanner）
2. 获取所有 Markdown 文件
3. 遍历每个 MD 文件：
   → 读取内容
   → parseReferences（解析所有引用）
   → 解析引用路径（相对路径 → 绝对路径）
   → 记录：imagePath → Set<notePath>
4. 孤立图片 = 所有图片 - 被引用的图片
```

### 引用路径解析

引用路径可能是：
- 相对路径：`../assets/img.png`
- 绝对路径：`/assets/img.png`
- 仅文件名：`img.png`

解析优先级（`resolveRefPath` in main.ts）：
1. 绝对路径（以 `/` 开头）→ 去掉 `/` 后 normalizePath
2. 显式相对路径（以 `../` 或 `./` 开头）→ 基于笔记目录计算
3. 包含 `/` 的路径 → 先尝试绝对路径，再尝试相对路径
4. 仅文件名 → 先查笔记目录，再查 vault 根，最后全局搜索

### 引用查找：`getReferencingNotes`

查找所有引用指定图片的笔记，返回路径和行号：
```typescript
const refs = await orphanFinder.getReferencingNotes(file);
// [{ path: 'notes/blog.md', lines: [5, 12] }]
```

## 使用场景

| 场景 | 调用方法 | 说明 |
|------|----------|------|
| 图片浏览器 | `scanner.getAllImages()` + `scanLocalOrphans()` + 过滤/排序 | ImageBrowserModal |
| 孤立图片检测 | `orphanFinder.findOrphans()` | OrphanImagesModal |
| 批量上传 | `scanner.getAllImages()` | main.ts batchUpload |
| 预览引用列表 | `orphanFinder.getReferencingNotes(file)` | ImagePreviewModal |

## 性能优化

1. **缓存**：`vault.cachedRead` 读取文件内容（利用 Obsidian 缓存）
2. **批量处理**：一次性扫描所有文件，避免重复扫描
3. **路径解析**：使用 `normalizePath` 标准化路径
4. **Set 去重**：使用 Set 记录被引用的图片路径
