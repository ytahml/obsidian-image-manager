# Modal 组件

## 文件：`src/modals/`

包含本地图片、远程浏览/预览以及远程删除确认/结果等 Modal 组件。

## 1. ImageBrowserModal (`image-browser.ts`)

**功能**：网格视图浏览 vault 中的所有图片

**特性**：
- “图片浏览器”标题与“本地图片 / 图床图片”切换位于同一响应式标题栏
- 搜索框（300ms 防抖）
- 排序（名称、大小、修改时间、创建时间）
- 孤立图片筛选开关
- 缩略图网格（可调大小 80-400px）；少量结果按内容高度贴顶排列，不随 Modal 剩余高度拉伸卡片
- 点击缩略图打开预览
- Modal 在桌面端最大约 `1100px × 84vh`，在信息密度和对编辑区的遮挡之间保持平衡；移动端接近全屏但保留 8–12px 安全边距，并缩小卡片最小列宽

**依赖**：`ImageScanner`、`OrphanFinder`、`ImagePreviewModal`

**设置门控**：`enableImageBrowser=false` 时命令不可用

G3 后该 Modal 是本地/图床的共同外壳：默认本地视图保持既有搜索、孤立筛选和预览；图床视图位于独立的 `remote-image-browser.ts`，只有用户点击扫描、继续扫描或刷新时才请求列表 Provider。

远程视图采用响应式图片卡片。扫描期间显示 spinner、进行中文案并设置 `aria-busy`；空前缀确认中的“继续扫描”在提交后也立即显示 spinner 和“正在扫描”，同时禁用取消及重复提交。明确扫描前不创建远程 `<img>`。扫描后卡片进入网格可视区域前约 200px 时自动加载缩略图，URL 解析队列最多 4 并发。卡片行按内容高度贴顶排列，单张或少量图片不会被网格剩余高度纵向拉伸。引用徽标使用语义颜色：绿色为已引用、橙色为孤立图片、灰色为无法判断。已引用卡片不再重复显示“该图片已被当前仓库引用”的删除禁用正文，其他需要用户处理的禁用原因仍保留。

S3 扫描失败只影响当前浏览会话，结构化错误码在 UI 中映射为中英文配置、认证、权限、Bucket 不存在、限流、网络、解析或服务错误；不显示 Provider 原始 XML 文本或签名 URL。

缩略图和大图都只在设置远程 `<img src>` 时计数。关闭浏览器、切换图床、编辑前缀或刷新扫描会移除图片 URL、清空预览缓存并作废迟到的签名或图片事件；搜索、排序和筛选会重建当前卡片观察器，但可继续复用尚未临近过期的会话 URL。

远程搜索使用 300ms 防抖且只重绘结果区，不销毁正在输入的搜索框；切换图床或修改管理前缀时清空旧搜索条件。扫描内部自动聚合多页元数据，每最多 10 次、每次最多 1000 项后暂停并显示“继续扫描”；搜索、排序和引用状态筛选作用于全部已扫描结果。结果不再分页，首批渲染 60 张卡片，滚动到底部时继续追加 60 张。管理前缀在 `input` 时同步更新会话配置并防抖持久化。S3 在前缀输入框之前提供“选择文件夹”：用户主动打开后按层读取虚拟文件夹，支持根目录、面包屑、进入子目录、分页加载和选择当前目录；手动输入继续作为高级备用。

启用远程对象管理后，fresh Markdown 索引中明确未引用的对象以“孤立图片 / Orphan image”展示，并在卡片提供选择控件。标准 Markdown 图片、普通链接、HTML、frontmatter、Wiki 包裹和原始 URL 中只要地址可可靠映射，都统一显示为“已引用”并阻止删除。独立远程预览 Modal 展示引用笔记与行号，点击行号会关闭图片浏览器、打开笔记并定位。选择跨搜索、排序和渐进渲染保留，最多 20 项。专用 `RemoteDeleteConfirmModal` 使用面向用户的不可撤销与服务商策略提示，同时要求输入所选数量并勾选云端删除确认；成功项统一显示“请求成功”，结构化 delete-marker/unknown 语义只保留在内存结果和脱敏审计中。

远程大图预览将 loading 放在图片画布区域内，成功后由同一区域直接显示图片，标题和图片本身即为成功反馈，不再显示冗余的“预览已加载”。失败反馈也显示在图片区域内，并保留人工重试入口。

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
- 顶部固定名称、服务商类型和启用状态；使用无外框的轻量表单，启用项保持单行；桌面端三列、移动端单列
- 只保留“图床配置 / 远程管理”两个页签；服务商连接与上传/访问在图床配置页内使用轻量分组标题连续展示，切换时保留尚未保存的输入
- 当前页签内容独立滚动，底部保存/取消操作固定可见；桌面端服务商字段两列排列，移动端自动单列
- 远程管理关闭时折叠目录、预览和 URL alias 字段
- 根据 `HostingType` 动态渲染字段
- 阿里云 OSS、七牛和 S3 显示上传路径与公共访问 URL 基础路径；基础路径可包含 bucket 或目录
- 自定义图床隐藏上述两个无效字段，保留已有配置数据，公开 URL 继续从响应 JSON 提取
- 支持 4 种服务商：
  - 阿里云 OSS：region、accessKeyId、accessKeySecret、bucket
  - 七牛云：accessKey、secretKey、bucket、region
  - S3：endpoint、region、accessKeyId、secretAccessKey、bucket、forcePathStyle
  - 自定义：uploadUrl、method、headers、fileFieldName、jsonPath、extraBody
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
    pendingText?: string;   // 异步确认期间的按钮文案
    onConfirm: () => void | Promise<void>;
    onCancel?: () => void;
}
```

**特性**：
- Enter 确认，Escape 取消
- `isComposing` 检查（IME 兼容）
- 异步确认期间按钮显示 spinner，设置 `aria-busy`，并阻止重复提交

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
