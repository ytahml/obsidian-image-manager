# 已知问题与修复记录

## 已修复问题

### 1. IME 输入法回车触发表单提交（1.0.1）

**问题**：中文输入法下按回车确认选字时，会直接触发表单提交

**根因**：`keydown` 事件未检查 `e.isComposing` 状态

**修复文件**：
- `src/modals/image-name-prompt.ts`
- `src/modals/rename-image.ts`
- `src/modals/confirm-dialog.ts`

**修复方式**：
```typescript
inputEl.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.isComposing) return; // ← 新增
    if (e.key === 'Enter') {
        e.preventDefault();
        this.submit();
    }
});
```

**效果**：输入法组合状态下按回车不会触发提交

---

### 2. 插件 ID 不符合规范（1.0.2）

**问题**：原 ID `obsidian-image-manager` 包含 "obsidian"，违反社区规范

**修复**：重命名为 `md-image-manager`

**影响**：用户需要重新启用插件

---

### 3. 插件描述包含 "Obsidian"（1.0.3）

**问题**：描述中包含 "Obsidian"，违反社区指南

**修复**：移除描述中的 "Obsidian"

---

### 4. 重命名丢失目录路径（1.0.5）

**问题**：Obsidian 内置重命名将 `![alt](assets/folder/old.png)` 变为 `![alt](new.png)`，丢失目录路径

**根因**：Obsidian 的链接更新器在重命名时会剥离 Markdown 引用中的目录路径

**修复**：
1. 监听 `vault rename` 事件
2. 延迟 100ms 等待 Obsidian 完成内置更新
3. 调用 `fixBrokenImageRefs` 恢复目录路径

```typescript
this.registerEvent(
    this.app.vault.on('rename', (file, oldPath) => {
        if (!(file instanceof TFile) || !this.isImageFile(file)) return;
        window.setTimeout(() => {
            void this.batchRename.fixBrokenImageRefs(oldPath, file.path);
        }, 100);
    })
);
```

**时序关键**：必须在 Obsidian 内置更新完成后执行

---

### 5. 插件审核报错（1.0.6）

**问题**：多个插件审核规则违规

**修复项**：
- API 兼容性：`minAppVersion` 从 1.4.0 提升到 1.7.0（`trashFile` API 需要 1.6.6+）
- Sentence case：UI 文本改为 sentence case
- 事件处理器守卫：`editor-paste`/`editor-drop` 添加 `evt.defaultPrevented` 检查
- Popout 窗口兼容：`setTimeout` → `window.setTimeout`，`document` → `activeDocument`

---

### 6. 引用计数错误（1.0.7）

**问题**：同一篇笔记引用 5 次显示 "1 note(s)" 而非 "5 reference(s)"

**根因**：统计时仅去重笔记数，未统计所有引用

**修复**：改为统计所有引用数量，显示格式改为 `X reference(s) in Y note(s)`

---

### 7. settings.ts deprecated 警告过多（1.0.7）

**问题**：`display()` 方法已废弃（Obsidian 1.13.0 起），产生 5 个 deprecated 警告

**临时修复**：新增 `refresh()` 方法封装所有 `display()` 调用，将警告从 5 处降至 1 处

**完整修复**：最低兼容版本升级到 Obsidian 1.13.0 后，迁移到 `getSettingDefinitions()` 声明式 API

---

### 8. 整理图片使用绝对路径（1.0.8）

**问题**：当 `imagePathBase` 为 "note" 时，整理图片命令使用 vault 绝对路径而非相对路径

**根因**：`ImageReorganizer.reorganizeNote` 未检查 `imagePathBase` 设置，始终使用 `finalPath`（绝对路径）构建引用

**修复**：
1. `RefConverter.computeRelativePath` 改为 public
2. `reorganizeNote` 中根据 `imagePathBase` 计算相对路径
3. 删除错误的跳过条件，始终比较引用是否需要更新
4. 保存条件改为检查内容是否变化

**修复文件**：
- `src/utils/ref-converter.ts`
- `src/utils/image-reorganizer.ts`

---

### 9. 与 Obsidian "始终更新内部链接" 冲突（1.0.8）

**问题**：开启"始终更新内部链接"后，手动移动图片会导致引用从相对路径变为旧位置的绝对路径

**根因**：
1. `vault.rename` 触发 `vault.on('rename')` 事件
2. Obsidian 内置链接更新器和插件的 `fixBrokenImageRefs` 同时运行
3. `fixBrokenImageRefs` 用 `oldPath` 恢复目录，移动场景应用 `newPath`

**修复**：
1. 添加 `isReorganizing` 标志，整理期间跳过 `fixBrokenImageRefs`
2. 移动时用 `newPath` 计算目录，重命名时用 `oldPath`
3. `fixBrokenImageRefs` 根据 `imagePathBase` 设置使用相对路径

**修复文件**：
- `src/main.ts`
- `src/utils/batch-rename.ts`

---

## 待实现功能

### 图床迁移

**状态**：命令已注册（`migrate-images`），类型已定义（`MigrationRecord`/`MigrationChange`），显示"未实现"提示

**需要**：
- 实现迁移逻辑：下载旧图床图片 → 上传到新图床 → 更新所有引用
- 迁移记录持久化
- 迁移历史查看

### 恢复本地引用

**状态**：翻译键已存在（`command.restoreLocalRefs` 等），无实现代码

**需要**：
- 将远程图片引用恢复为本地引用
- 下载远程图片到本地
- 更新引用格式

---

## 常见问题排查

### 插件不加载

1. 检查 `main.js` 和 `manifest.json` 是否在 `<Vault>/.obsidian/plugins/md-image-manager/`
2. 检查 `manifest.json` 的 `id` 是否为 `md-image-manager`
3. 重新加载 Obsidian

### 构建失败

1. `npm run lint` 检查 ESLint 错误
2. `tsc -noEmit` 检查 TypeScript 错误
3. 检查 Node 版本（Volta 固定 22.22.3）

### 设置不生效

1. 检查 `types.ts` 的 `DEFAULT_SETTINGS` 是否有默认值
2. 检查 `settings.ts` 是否正确渲染 UI
3. 检查 `main.ts` 是否正确读取设置值

### 上传失败

1. 检查图床配置是否正确
2. 使用"测试连接"按钮验证
3. 检查控制台错误信息
4. 确认 `reorganizeConvertFormat=true`（图床功能前置条件）
