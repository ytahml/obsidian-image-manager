# 批量重命名

## 文件：`src/utils/batch-rename.ts`

## BatchRename 类

```typescript
class BatchRename {
    constructor(app: App, settings: ImageManagerSettings);

    // 重命名图片并更新所有引用
    renameImage(file: TFile, newName: string): Promise<RenameResult>;

    // 修复 Obsidian 内置重命名后的引用
    fixBrokenImageRefs(oldPath: string, newPath: string): Promise<number>;
}
```

**构造函数参数**：
- `app`: Obsidian App 实例
- `settings`: 插件设置，用于 `fixBrokenImageRefs` 计算相对路径

## RenameResult

```typescript
interface RenameResult {
    file: TFile;          // 重命名后的文件
    oldName: string;      // 旧文件名
    newName: string;      // 新文件名
    notesUpdated: number; // 更新的笔记数量
}
```

## 重命名流程：`renameImage`

**关键时序**：必须在 `vault.rename()` **之前**更新引用！

```
1. updateReferencesBeforeRename（更新所有引用）
   → 遍历所有 MD 文件
   → parseReferences
   → 匹配：refName === oldName || ref.path === oldPath || ref.path === oldName
   → buildUpdatedRef（构建新引用，保留目录路径）
   → vault.process 更新笔记

2. vault.rename(file, newPath)（重命名文件）

3. 验证重命名成功
4. 返回 RenameResult
```

### 为什么先更新引用再重命名？

Obsidian 内置的链接更新器会在 `vault.rename()` 后自动更新 wiki 链接。如果我们先重命名再更新引用，Obsidian 的更新会覆盖我们的更新，导致引用丢失目录路径。

### buildUpdatedRef

构建更新后的引用，保留原有目录路径：

```typescript
private buildUpdatedRef(ref, oldName, newName, oldPath): string {
    let newRefPath: string;

    if (ref.path === oldPath || ref.path === oldName) {
        // 完整路径匹配或纯文件名 → 替换整个路径
        const dir = oldPath.substring(0, oldPath.lastIndexOf('/'));
        newRefPath = dir ? `${dir}/${newName}` : newName;
    } else {
        // 文件名匹配 → 保留引用自身的目录
        const dir = ref.path.substring(0, ref.path.lastIndexOf('/'));
        newRefPath = dir ? `${dir}/${newName}` : newName;
    }

    // 根据格式构建引用
    if (ref.format === 'wiki') {
        return ref.altText ? `![[${newRefPath}|${ref.altText}]]` : `![[${newRefPath}]]`;
    }
    return `![${ref.altText}](${encodePathSegments(newRefPath)})`;
}
```

## 修复引用：`fixBrokenImageRefs`

### 问题背景

Obsidian 内置重命名会将 Markdown 图片引用的目录路径剥离：
```
重命名前：![alt](assets/folder/old.png)
重命名后：![alt](new.png)  ← 丢失了 assets/folder/ 目录
```

### 修复流程

```
1. 遍历所有 MD 文件
2. parseReferences
3. 匹配：ref.path === newName || ref.path.split('/').pop() === newName
4. 检查引用是否已指向有效文件（跳过已正确的引用）
5. 恢复目录路径：
   - 重命名（目录不变）：用 oldPath 的目录
   - 移动（目录变化）：用 newPath 的目录
6. 如果 imagePathBase 为 'note'，计算相对路径
7. 构建正确引用：correctPath
8. 如果 ref.path !== correctPath → 更新
9. 同时更新 alt 文本（如果 alt 是旧文件名）
```

### 触发时机

```typescript
// main.ts
this.registerEvent(
    this.app.vault.on('rename', (file, oldPath) => {
        if (!(file instanceof TFile) || !this.isImageFile(file)) return;
        if (this.isReorganizing) return; // 整理期间跳过
        window.setTimeout(() => {
            void this.batchRename.fixBrokenImageRefs(oldPath, file.path);
        }, 100); // 等待 Obsidian 完成内置更新
    })
);
```

**延迟 100ms**：等待 Obsidian 内置链接更新器完成后再修复。
**isReorganizing 标志**：防止整理图片时 `fixBrokenImageRefs` 覆盖已正确的引用。

## UI 集成

### 命令面板

```typescript
this.addCommand({
    id: 'rename-image',
    name: t('command.renameImage'),
    checkCallback: (checking) => {
        const file = this.app.workspace.getActiveFile();
        if (!file || !this.isImageFile(file)) return false;
        if (!checking) this.renameImage(file);
        return true;
    },
});
```

### 图片浏览器预览

```typescript
// ImagePreviewModal 中的重命名按钮
new ButtonComponent(buttonContainerEl)
    .setIcon('pencil')
    .setTooltip(t('preview.rename'))
    .onClick(() => {
        new RenameImageModal(this.app, file, (newName) => {
            void this.plugin.batchRename.renameImage(file, newName).then((result) => {
                new Notice(t('notice.renameSuccess', { ... }));
                // 刷新预览
            });
        }).open();
    });
```

## RenameImageModal

简单的输入对话框：
- 只显示文件名主干（不含扩展名）
- 自动保留扩展名
- Enter 确认，Escape 取消
- `isComposing` 检查（IME 兼容）

## 注意事项

1. **时序关键**：必须先更新引用再重命名，否则 Obsidian 内置更新会冲突
2. **目录路径保留**：重命名时保留引用中的目录路径
3. **alt 文本更新**：如果 alt 文本是旧文件名，同步更新为新文件名
4. **延迟修复**：Obsidian 内置重命名后的修复需要延迟 100ms
5. **IME 兼容**：RenameImageModal 的 keydown 事件检查 `isComposing`
6. **上传引用隔离**：图床上传后的引用替换只处理本地路径；远程 URL 不参与文件名匹配，避免同名远程图片被二次改写
