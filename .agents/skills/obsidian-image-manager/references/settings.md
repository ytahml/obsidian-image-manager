# 设置面板

## 文件：`src/settings.ts`

## ImageManagerSettingTab 类

```typescript
class ImageManagerSettingTab extends PluginSettingTab {
    plugin: ImageManagerPlugin;

    display(): void;           // 主渲染方法
    refresh(): void;           // 封装 display()，减少 deprecated 警告

    // 6 个模块化渲染方法
    private renderLanguage(containerEl: HTMLElement): void;
    private renderGeneral(containerEl: HTMLElement): void;
    private renderImageNaming(containerEl: HTMLElement): void;
    private renderCompression(containerEl: HTMLElement): void;
    private renderGallery(containerEl: HTMLElement): void;
    private renderImageHosting(containerEl: HTMLElement): void;

    // 图床列表渲染
    private renderHostingList(container: HTMLElement): void;
}
```

## 渲染结构

```
display()
├── renderLanguage        // 语言切换（en/zh）
├── renderGeneral         // 通用设置（带 heading）
│   ├── 图片路径模板 (text)
│   ├── 路径基准 (dropdown: vault/note)
│   ├── 使用 Markdown 格式 (toggle)
│   └── 跳过 Wiki 引用 (toggle)
├── renderImageNaming     // 图片命名（带 heading）
│   ├── 命名模板 (text，支持 {noteName})
│   └── 提示输入名称 (toggle)
├── renderCompression     // 压缩（带 heading）
│   ├── 自动压缩 (toggle)
│   └── 压缩质量 (slider: 1-100)
├── renderGallery         // 画廊（带 heading）
│   ├── 启用浏览器 (toggle)
│   └── 缩略图大小 (slider: 80-400)
└── renderImageHosting    // 图床（带 heading）
    ├── [条件] 未启用 MD 格式提示
    ├── [条件] 图床配置列表 (renderHostingList)
    ├── 添加图床 (button → HostingConfigModal)
    ├── 默认图床 (dropdown, 仅多个启用时显示)
    ├── 上传路径模板 (text)
    ├── 上传后自动替换 (toggle)
    ├── 粘贴时自动上传 (toggle)
    └── 保留本地副本 (toggle，关闭时清理空的直接附件目录)
```

上传路径模板按“图床专属模板 → 全局模板 → 默认模板”的顺序解析。`{sourceDir}` 表示图片相对于 Vault 根目录的父目录；使用它会将该目录结构作为远端对象 key 的一部分发送给图床服务商。

图床配置中的 `urlPrefix` 显示为“公共访问 URL 基础路径”，所有非自定义图床使用统一的帮助文案，可包含 bucket。七牛云必须配置；阿里云 OSS 和 S3 留空时使用默认服务端 URL。自定义图床不显示上传路径和公共访问基础路径，因为其路径协议未知且公开 URL 来自响应 JSON。

`HostingConfigModal` 使用固定基础信息和“图床配置 / 远程管理”两个页签，选中页签使用 Obsidian 主题强调色。宽屏下名称与服务商类型两组“标签 + 220px 控件”并排为一行，窄窗口和移动端自动上下排列；基础信息不使用原生 `Setting` 容器，避免主题注入相邻字段分隔线。启用状态不在编辑 Modal 中重复出现。非 Custom 图床的上传路径与公共访问 URL 无分组标题、无相邻字段横线地固定显示在页签上方；页签分区上方单独保留一根横线。图床配置页只承载 endpoint/region/bucket/凭据等服务商连接字段；Custom 的请求映射仍留在图床配置页。正文在桌面端使用较宽的左侧说明区和统一对齐的右侧控件，移动端改为名称在上、控件在下。只有页签正文滚动，保存/取消保持可见。页签切换直接复用内存中的配置副本，不新增持久化字段。

图床配置的“远程管理”页签中，旧配置默认关闭；关闭时只显示开关和流量说明，开启后才显示管理前缀（空值为当前 Bucket 根）和其他引用 URL 基础路径（一行一个）。其他引用 URL 基础路径仅用于把 CDN、旧域名或其他公开域名下的仓库引用映射到对象 key，不参与上传、预览或删除请求。开启文案明确说明：手动扫描完成后，可视区域图片会自动读取，可能产生原图下载流量和服务商费用。S3 额外显示明确的预览访问方式，旧配置默认“私有 Bucket（临时签名）”；公开模式只使用 `urlPrefix`，留空时允许保存但图片不可用并显示提示。图片浏览器中的 S3 管理前缀可以通过虚拟文件夹选择器填写，也继续允许手动输入。页码、每页数量、缩略图模式和删除均不设置独立开关；旧 `pageSize`、`previewMode` 仅作 `data.json` 兼容。删除仍受专用确认 Modal 和引用索引门禁保护。保存会去除前缀首尾 `/`，但不推断上传模板或修改中间路径。

## refresh() 封装

```typescript
refresh() {
    this.display();
}
```

1.0.7 新增，封装所有 `display()` 调用，将 deprecated 警告从 5 处降至 1 处。

## 条件渲染

### 图床区域门控

```typescript
private renderImageHosting(containerEl: HTMLElement) {
    new Setting(containerEl).setName(t('settings.imageHosting')).setHeading();

    if (!this.plugin.settings.reorganizeConvertFormat) {
        containerEl.createDiv({
            cls: 'setting-item-description',
            text: t('settings.hostingDisabledByFormat'),
        });
        return; // 不渲染后续内容
    }
    // ... 正常渲染
}
```

### 默认图床下拉

仅当启用的图床配置 > 1 时显示：
```typescript
const enabledConfigs = this.plugin.settings.hostingConfigs.filter((c) => c.enabled);
if (enabledConfigs.length > 1) {
    // 渲染默认图床下拉
}
```

## 图床配置列表：`renderHostingList`

每个配置项包含：
- 状态指示器（● 启用 / ○ 禁用）
- 名称和类型
- 启用/禁用按钮（直接保存；禁用当前默认图床时切换到下一个已启用配置）
- 编辑按钮 → `HostingConfigModal`
- 删除按钮 → `ConfirmDialog`

### 添加新配置

```typescript
const newConfig: ImageHostingConfig = {
    id: `hosting-${Date.now()}`,
    name: '',
    type: 'aliyun-oss',
    enabled: true,
    config: { region: '', accessKeyId: '', accessKeySecret: '', bucket: '' },
    uploadPath: '',
    urlPrefix: '',
};
new HostingConfigModal(this.app, newConfig, (saved) => {
    this.plugin.settings.hostingConfigs.push(saved);
    void this.plugin.saveSettings().then(() => this.refresh());
}).open();
```

### 编辑配置

```typescript
new HostingConfigModal(this.app, config, (saved) => {
    const idx = this.plugin.settings.hostingConfigs.findIndex((c) => c.id === saved.id);
    if (idx >= 0) {
        this.plugin.settings.hostingConfigs[idx] = saved;
    }
    void this.plugin.saveSettings().then(() => this.refresh());
}).open();
```

### 删除配置

```typescript
new ConfirmDialog(this.app, {
    title: t('settings.deleteHosting'),
    message: t('settings.deleteHostingMsg', { name: config.name || config.type }),
    onConfirm: async () => {
        this.plugin.settings.hostingConfigs = this.plugin.settings.hostingConfigs.filter(
            (c) => c.id !== config.id
        );
        await this.plugin.saveSettings();
        this.refresh();
    },
}).open();
```

## 设置保存模式

所有设置项使用相同的模式：
```typescript
.addToggle((toggle) =>
    toggle
        .setValue(this.plugin.settings.someSetting)
        .onChange(async (value) => {
            this.plugin.settings.someSetting = value;
            await this.plugin.saveSettings();
            // 可选：this.refresh() 刷新 UI
        })
)
```

## 新增设置项步骤

1. 在 `types.ts` 的 `ImageManagerSettings` 添加字段
2. 在 `DEFAULT_SETTINGS` 添加默认值
3. 在 `settings.ts` 的对应 `render*` 方法添加 UI 控件
4. 在 `i18n/en.ts` 和 `i18n/zh.ts` 添加翻译键
5. 在 `main.ts` 或相关 utils 中使用设置值

## 待重构：display() → getSettingDefinitions()

参见 `display-refactor-solution.md`，Obsidian 1.13.0 起 `display()` 已废弃，应迁移到声明式 `getSettingDefinitions()` API。当前 `minAppVersion` 为 1.12.0，需升级到 1.13.0 后才能迁移。
