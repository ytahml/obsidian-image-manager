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
│   ├── 命名模板 (text)
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
    └── 保留本地副本 (toggle)
```

上传路径模板按“图床专属模板 → 全局模板 → 默认模板”的顺序解析。`{sourceDir}` 表示图片相对于 Vault 根目录的父目录；使用它会将该目录结构作为远端对象 key 的一部分发送给图床服务商。

图床配置中的 `urlPrefix` 显示为“公共访问 URL 基础路径”，所有非自定义图床使用统一的帮助文案，可包含 bucket。七牛云必须配置；阿里云 OSS 和 S3 留空时使用默认服务端 URL。自定义图床不显示上传路径和公共访问基础路径，因为其路径协议未知且公开 URL 来自响应 JSON。

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
