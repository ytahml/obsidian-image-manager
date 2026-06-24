# 资源整理

## 文件：`src/utils/image-reorganizer.ts`

## ImageReorganizer 类

```typescript
class ImageReorganizer {
    constructor(
        app: App,
        settings: ImageManagerSettings,
        resolveImagePath: (template: string, currentFile: TFile | null, filename: string) => string
    );

    // 整理单篇笔记
    reorganizeNote(noteFile: TFile, convertFormat?: ReferenceFormat): Promise<ReorganizeResult>;

    // 整理文件夹
    reorganizeFolder(folderPath: string, convertFormat?: ReferenceFormat): Promise<ReorganizeResult & { notes: number }>;
}
```

## ReorganizeResult

```typescript
interface ReorganizeResult {
    moved: number;   // 移动的文件数
    skipped: number; // 跳过的引用数
}
```

## 整理流程：`reorganizeNote`

```
1. 读取笔记内容
2. parseReferences（解析所有引用）
3. 反向遍历每个引用：
   a. 跳过外部 URL（http://、https://）
   b. 跳过 Wiki 引用（如果 skipWikiRefsOnReorganize=true）
   c. resolveImageFromRef（解析图片文件）
   d. resolveImagePath（计算目标路径）
   e. 判断是否需要移动：imageFile.path !== targetPath
   f. 判断是否需要格式转换：convertFormat !== ref.format
   g. 如果都不需要 → skipped
   h. 移动文件：vault.rename(imageFile, finalPath)
   i. 构建新引用（保持原格式或转换格式）
   j. 替换引用文本
4. 如果有移动或转换 → vault.process 更新笔记
5. 如果有移动 → updateOtherNotes 更新其他笔记
```

## 关键方法

### resolveImageFromRef

从引用路径解析出 TFile：
```typescript
private resolveImageFromRef(refPath: string): TFile | null {
    // 1. URL 解码
    let decodedPath = decodeURIComponent(refPath);

    // 2. 精确路径匹配
    const byPath = vault.getAbstractFileByPath(decodedPath);
    if (byPath instanceof TFile && this.isImageFile(byPath)) return byPath;

    // 3. 按文件名全局搜索
    const filename = decodedPath.split('/').pop() ?? decodedPath;
    const match = allImages.find((f) => f.name === filename || f.path === decodedPath);
    return match ?? null;
}
```

### ensureUniquePath

文件名冲突处理（同步版本，不同于 main.ts 的异步版本）：
```typescript
private ensureUniquePath(filePath: string): string {
    if (!vault.getAbstractFileByPath(filePath)) return filePath;

    const ext = filePath.split('.').pop() ?? '';
    const baseName = filePath.replace(new RegExp(`\\.${ext}$`), '');
    let counter = 1;
    let newPath = `${baseName}-${counter}.${ext}`;

    while (vault.getAbstractFileByPath(newPath)) {
        counter++;
        newPath = `${baseName}-${counter}.${ext}`;
    }
    return newPath;
}
```

### updateOtherNotes

更新其他笔记中对已移动图片的引用：
```
1. 获取所有 MD 文件（排除当前笔记）
2. 遍历每个文件：
   → parseReferences
   → 如果引用的文件不存在（路径已失效）
   → 按文件名查找新位置
   → 构建新引用
   → vault.process 更新
```

### buildRefPath

根据格式构建引用路径：
- Wiki：仅文件名
- Markdown：URL 编码的完整路径

## 整理文件夹：`reorganizeFolder`

```
1. 获取文件夹内所有 MD 文件
2. 逐个调用 reorganizeNote
3. 累计 moved 和 skipped
4. 返回 { moved, skipped, notes }
```

## 设置门控

| 设置 | 影响 |
|------|------|
| `reorganizeConvertFormat` | true → 转换为 MD 格式；false → 保持原格式 |
| `skipWikiRefsOnReorganize` | true → 跳过 Wiki 引用；false → 处理所有引用 |
| `imagePathTemplate` | 目标路径模板 |
| `imagePathBase` | 路径基准（vault/note） |

### 4 种行为组合

| reorganizeConvertFormat | skipWikiRefsOnReorganize | 行为 |
|-------------------------|--------------------------|------|
| true | true（默认） | 整理本地引用，跳过 Wiki |
| true | false | 整理所有引用（包括 Wiki） |
| false | true | 仅移动文件，跳过 Wiki |
| false | false | 仅移动文件，处理所有引用 |

## 右键菜单集成

```typescript
// 文件夹右键
menu.addItem((item) => {
    item.setTitle(`Markdown Image Manager: ${t('command.reorganizeImages')}`)
        .setIcon('image-file')
        .onClick(() => this.reorganizeFolder(file.path));
});

// MD 文件右键
menu.addItem((item) => {
    item.setTitle(`Markdown Image Manager: ${t('command.reorganizeImages')}`)
        .setIcon('image-file')
        .onClick(() => this.reorganizeNote(file));
});
```

## 注意事项

1. **反向遍历**：替换引用时从后往前处理，保持字符索引
2. **URL 解码**：引用路径可能包含 `%20` 等编码
3. **文件名冲突**：目标位置已有同名文件时自动添加后缀
4. **其他笔记更新**：移动文件后，其他笔记中的引用会失效，需要更新
5. **外部 URL 跳过**：`http://` 和 `https://` 开头的引用不处理
