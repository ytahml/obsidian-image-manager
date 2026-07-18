# Modal 组件

## 文件：`src/modals/`

共 7 个 Modal 组件。

## 1. ImageBrowserModal (`image-browser.ts`)

**功能**：网格视图浏览 vault 中的所有图片

**特性**：
- 搜索框（300ms 防抖）
- 排序（名称、大小、修改时间、创建时间）
- 孤立图片筛选开关
- 缩略图网格（可调大小 80-400px）
- 点击缩略图打开预览

**依赖**：`ImageScanner`、`OrphanFinder`、`ImagePreviewModal`

**设置门控**：`enableImageBrowser=false` 时命令不可用

G3 后该 Modal 是本地/图床的共同外壳：默认本地视图保持既有搜索、孤立筛选和预览；图床视图位于独立的 `remote-image-browser.ts`，仅在用户点击扫描、翻页或刷新时请求 Provider。

远程视图只显示 key、大小、修改时间、ETag、存储类型和保守引用状态。没有远程 `<img>`、预览、选择或删除按钮。空前缀会在每个 Modal 会话首次扫描前确认；取消不会请求网络。S3-compatible 可手动执行 metadata-only ListObjectsV2；尚未实现 list 能力的其他图床显示原因且不显示扫描按钮。

S3 扫描失败只影响当前浏览会话，结构化错误码在 UI 中映射为中英文配置、认证、权限、Bucket 不存在、限流、网络、解析或服务错误；不显示 Provider 原始 XML 文本或签名 URL。

## 2. ImagePreviewModal (`image-preview-modal.ts`)

**功能**：全屏图片预览

**特性**：
- 图片信息（文件名、大小、尺寸）
- 引用列表（可展开详情）
  - 按笔记分组
  - 每篇笔记显示引用行号
  - 点击行号跳转到对应位置
- 操作按钮：
  - 复制引用
  - 插入到当前笔记
  - 上传到图床
  - 重命名
  - 关闭

复制和插入生成标准 Markdown 引用，路径通过 `encodePathSegments` 编码敏感 ASCII，同时保留中文等 Unicode 可读。

**引用计数**：
- 1.0.7 修复：统计所有引用而非仅去重笔记数
- 显示格式：`5 reference(s) in 1 note(s)`

## 3. OrphanImagesModal (`orphan-images.ts`)

**功能**：检测并管理孤立图片

**特性**：
- 复选框列表
- 全选/全不选
- 显示总大小
- 批量删除（使用 `fileManager.trashFile`）

**依赖**：`OrphanFinder`

## 4. RenameImageModal (`rename-image.ts`)

**功能**：重命名图片文件

**特性**：
- 输入框只显示文件名主干（不含扩展名）
- 自动保留扩展名
- Enter 确认，Escape 取消
- `isComposing` 检查（IME 兼容）

## 5. HostingConfigModal (`hosting-config.ts`)

**功能**：图床配置表单

**特性**：
- 根据 `HostingType` 动态渲染字段
- 阿里云 OSS、七牛和 S3 显示上传路径与公共访问 URL 基础路径；基础路径可包含 bucket 或目录
- 自定义图床隐藏上述两个无效字段，保留已有配置数据，公开 URL 继续从响应 JSON 提取
- 支持 4 种服务商：
  - 阿里云 OSS：region、accessKeyId、accessKeySecret、bucket
  - 七牛云：accessKey、secretKey、bucket、region
  - S3：endpoint、region、accessKeyId、secretAccessKey、bucket、forcePathStyle
  - 自定义：uploadUrl、method、headers、fileFieldName、jsonPath、extraBody
- 测试连接按钮
- 保存/取消

## 6. ConfirmDialog (`confirm-dialog.ts`)

**功能**：通用确认对话框

**接口**：
```typescript
interface ConfirmDialogOptions {
    title: string;
    message: string;
    confirmText?: string;   // 默认 "Confirm"
    cancelText?: string;    // 默认 "Cancel"
    onConfirm: () => void | Promise<void>;
    onCancel?: () => void;
}
```

**特性**：
- Enter 确认，Escape 取消
- `isComposing` 检查（IME 兼容）

## 7. ImageNamePromptModal (`image-name-prompt.ts`)

**功能**：粘贴/拖放时的图片命名输入

**特性**：
- 显示默认文件名（模板生成）
- 用户可修改
- Enter 确认，Escape 取消
- `isComposing` 检查（IME 兼容）

## 公共模式

### IME 兼容

所有有 Enter 键处理的 Modal 都检查 `isComposing`：
```typescript
inputEl.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.isComposing) return; // IME 组合状态
    if (e.key === 'Enter') {
        e.preventDefault();
        this.submit();
    }
});
```

### Modal 生命周期

```typescript
class MyModal extends Modal {
    constructor(app: App, ...) {
        super(app);
    }

    onOpen() {
        const { contentEl } = this;
        // 渲染 UI
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty(); // 清理 DOM
    }
}
```

### Obsidian 官方规则要求

1. **Sentence case**：UI 文本首字母大写，其余小写
2. **No manual HTML headings**：用 `new Setting().setHeading()` 代替 `createEl('h3')`
3. **No static styles assignment**：用 CSS 类代替 `element.style.*`
4. **Prefer activeDocument**：用 `activeDocument` 代替 `document`
5. **Prefer window timers**：用 `window.setTimeout` 代替 `setTimeout`
