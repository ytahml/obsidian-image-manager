# 设置面板

## 文件：`src/settings.ts`

## ImageManagerSettingTab 类

```typescript
class ImageManagerSettingTab extends PluginSettingTab {
    plugin: ImageManagerPlugin;

    getSettingDefinitions(): SettingDefinitionItem[]; // Obsidian 1.13+ 声明式设置与搜索索引
    display(): void;           // Obsidian 1.12 imperative fallback
    refresh(): void;           // 1.13+ update() / 1.12 display() 兼容刷新

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

## 渲染结构与版本兼容

Obsidian 1.13.0 及以上从 `getSettingDefinitions()` 渲染并建立设置搜索索引；语言、通用、命名、压缩、画廊均按单个设置项索引。图床管理含动态配置卡片和 Modal 操作，继续通过一个可搜索的自定义 `render` 定义复用既有渲染器，其 aliases 覆盖添加图床、默认图床、上传路径与自动上传等子项。

`minAppVersion` 仍为 1.12.0，因此保留 `display()` 作为旧版 Obsidian fallback。两条路径必须维持相同设置顺序、默认值、保存副作用和条件门控；只有最低兼容版本升级到 1.13.0 后才可删除 fallback。

```
getSettingDefinitions() / display() fallback
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

`HostingConfigModal` 使用固定基础信息和 capability 门控的页签。所有图床都有“图床配置”；只有生产 Provider registry 中具备 `list` capability 的配置显示“远程管理”，当前即 S3-compatible。阿里云 OSS、七牛和 Custom 在配置正文提示“目前仅支持 S3 兼容存储”，不显示无效远程页签。选中页签使用 Obsidian 主题强调色。宽屏下名称与服务商类型两组“标签 + 220px 控件”并排为一行，窄窗口和移动端自动上下排列；基础信息不使用原生 `Setting` 容器，避免主题注入相邻字段分隔线。启用状态不在编辑 Modal 中重复出现。非 Custom 图床的上传路径与公共访问 URL 无分组标题、无相邻字段横线地固定显示在页签上方；页签分区上方单独保留一根横线。图床配置页只承载 endpoint/region/bucket/凭据等服务商连接字段；Custom 的请求映射仍留在图床配置页。正文在桌面端使用较宽的左侧说明区和统一对齐的右侧控件，移动端改为名称在上、控件在下。只有页签正文滚动，保存/取消保持可见。页签切换直接复用内存中的配置副本，不新增持久化字段。

图床配置的“远程管理”页签顶部只提示“目前仅支持 S3 兼容存储”。旧配置默认关闭；关闭时只显示开关和流量说明，开启后才显示管理前缀（空值为当前 Bucket 根）和其他引用 URL 基础路径。其他引用 URL 基础路径每行一个，不使用逗号或分号分隔；placeholder 给出两个多行示例，并即时标记非 HTTP(S)、含账号、query 或 fragment 的无效行。每个基础路径必须指向对象 key 开始前的位置，仅用于把 CDN、旧域名或其他公开域名下的仓库引用映射到对象 key，不参与上传、预览或删除请求。开启文案明确说明：手动扫描完成后，可视区域图片会自动读取，可能产生原图下载流量和服务商费用。S3 额外显示明确的预览访问方式，旧配置默认“私有 Bucket（临时签名）”；公开模式只使用 `urlPrefix`，留空时允许保存但图片不可用并显示提示。图片浏览器中的 S3 管理前缀可以通过虚拟文件夹选择器填写，也继续允许手动输入。页码、每页数量、缩略图模式和删除均不设置独立开关；旧 `pageSize`、`previewMode` 仅作 `data.json` 兼容。删除仍受专用确认 Modal 和引用索引门禁保护。保存会去除前缀首尾 `/`，但不推断上传模板或修改中间路径。

上述 S3-only 页签门控、精简提示、远程浏览配置筛选及 URL alias 多行输入/警告已于 2026-07-19 通过用户 Obsidian 验收。

## refresh() 兼容封装

```typescript
refresh() {
    const update: unknown = Reflect.get(this, 'update');
    if (typeof update === 'function') {
        Reflect.apply(update, this, []);
    } else {
        this.display();
    }
}
```

不能在兼容代码中直接调用 1.13.0 才提供的 `SettingTab.update()`，否则 `obsidianmd/no-unsupported-api` 会拒绝 `minAppVersion=1.12.0`。运行时能力检测让新版刷新声明式定义，旧版继续刷新 imperative UI。

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

声明式 `control` 项由 `PluginSettingTab` 读取 `plugin.settings` 并持久化。需要额外副作用或空值归一化的语言、Markdown 格式开关和两个模板输入使用声明式 `render` 回调，继续显式保存：
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
3. 在 `settings.ts` 的 `getSettingDefinitions()` 添加可搜索定义，并同步对应 `render*` fallback
4. 在 `i18n/en.ts` 和 `i18n/zh.ts` 添加翻译键
5. 在 `main.ts` 或相关 utils 中使用设置值

## 后续兼容清理

声明式搜索支持已完成。待最低兼容版本升级到 Obsidian 1.13.0 后，可删除 `display()` 及重复的 `renderLanguage`、`renderGeneral`、`renderImageNaming`、`renderCompression`、`renderGallery` fallback；图床动态渲染器仍可保留为声明式 `render` 项。
