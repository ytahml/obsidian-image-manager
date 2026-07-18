import { App, PluginSettingTab, Setting } from 'obsidian';
import type ImageManagerPlugin from './main';
import { DEFAULT_SETTINGS, ImageHostingConfig } from './types';
import { t, setLocale, type Locale } from './i18n';
import { HostingConfigModal } from './modals/hosting-config';
import { ConfirmDialog } from './modals/confirm-dialog';

export class ImageManagerSettingTab extends PluginSettingTab {
    plugin: ImageManagerPlugin;

    constructor(app: App, plugin: ImageManagerPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const { containerEl } = this;
        containerEl.empty();

        this.renderLanguage(containerEl);
        this.renderGeneral(containerEl);
        this.renderImageNaming(containerEl);
        this.renderCompression(containerEl);
        this.renderGallery(containerEl);
        this.renderImageHosting(containerEl);
    }

    /** 刷新设置面板（避免直接调用已废弃的 display()） */
    refresh() {
        this.display();
    }

    // --- Language ---

    private renderLanguage(containerEl: HTMLElement) {
        new Setting(containerEl)
            .setName(t('settings.language'))
            .setDesc(t('settings.languageDesc'))
            .addDropdown((dropdown) =>
                dropdown
                    .addOption('en', 'English')
                    .addOption('zh', '中文')
                    .setValue(this.plugin.settings.locale)
                    .onChange(async (value: string) => {
                        this.plugin.settings.locale = value as Locale;
                        setLocale(value as Locale);
                        await this.plugin.saveSettings();
                        this.refresh();
                    })
            );
    }

    // --- General ---

    private renderGeneral(containerEl: HTMLElement) {
        new Setting(containerEl).setName(t('settings.general')).setHeading();

        new Setting(containerEl)
            .setName(t('settings.imagePathTemplate'))
            .setDesc(t('settings.imagePathTemplateDesc'))
            .addText((text) =>
                text
                    .setPlaceholder(DEFAULT_SETTINGS.imagePathTemplate)
                    .setValue(this.plugin.settings.imagePathTemplate)
                    .onChange(async (value) => {
                        this.plugin.settings.imagePathTemplate = value || DEFAULT_SETTINGS.imagePathTemplate;
                        await this.plugin.saveSettings();
                    })
            );

        new Setting(containerEl)
            .setName(t('settings.imagePathBase'))
            .setDesc(t('settings.imagePathBaseDesc'))
            .addDropdown((dropdown) =>
                dropdown
                    .addOption('vault', t('settings.imagePathBase.vault'))
                    .addOption('note', t('settings.imagePathBase.note'))
                    .setValue(this.plugin.settings.imagePathBase)
                    .onChange(async (value: string) => {
                        this.plugin.settings.imagePathBase = value as 'vault' | 'note';
                        await this.plugin.saveSettings();
                    })
            );

        new Setting(containerEl)
            .setName(t('settings.useMarkdownFormat'))
            .setDesc(t('settings.useMarkdownFormatDesc'))
            .addToggle((toggle) =>
                toggle.setValue(this.plugin.settings.reorganizeConvertFormat).onChange(async (value) => {
                    this.plugin.settings.reorganizeConvertFormat = value;
                    await this.plugin.saveSettings();
                    this.refresh();
                })
            );

        new Setting(containerEl)
            .setName(t('settings.skipWikiRefsOnReorganize'))
            .setDesc(t('settings.skipWikiRefsOnReorganizeDesc'))
            .addToggle((toggle) =>
                toggle.setValue(this.plugin.settings.skipWikiRefsOnReorganize).onChange(async (value) => {
                    this.plugin.settings.skipWikiRefsOnReorganize = value;
                    await this.plugin.saveSettings();
                })
            );
    }

    // --- Image Naming ---

    private renderImageNaming(containerEl: HTMLElement) {
        new Setting(containerEl).setName(t('settings.imageNaming')).setHeading();

        new Setting(containerEl)
            .setName(t('settings.imageNamingTemplate'))
            .setDesc(t('settings.imageNamingTemplateDesc'))
            .addText((text) =>
                text
                    .setPlaceholder(DEFAULT_SETTINGS.imageNamingTemplate)
                    .setValue(this.plugin.settings.imageNamingTemplate)
                    .onChange(async (value) => {
                        this.plugin.settings.imageNamingTemplate = value || DEFAULT_SETTINGS.imageNamingTemplate;
                        await this.plugin.saveSettings();
                    })
            );

        new Setting(containerEl)
            .setName(t('settings.promptImageName'))
            .setDesc(t('settings.promptImageNameDesc'))
            .addToggle((toggle) =>
                toggle.setValue(this.plugin.settings.promptImageName).onChange(async (value) => {
                    this.plugin.settings.promptImageName = value;
                    await this.plugin.saveSettings();
                })
            );
    }

    // --- Compression ---

    private renderCompression(containerEl: HTMLElement) {
        new Setting(containerEl).setName(t('settings.compression')).setHeading();

        new Setting(containerEl)
            .setName(t('settings.autoCompress'))
            .setDesc(t('settings.autoCompressDesc'))
            .addToggle((toggle) =>
                toggle.setValue(this.plugin.settings.autoCompress).onChange(async (value) => {
                    this.plugin.settings.autoCompress = value;
                    await this.plugin.saveSettings();
                })
            );

        new Setting(containerEl)
            .setName(t('settings.compressQuality'))
            .setDesc(t('settings.compressQualityDesc'))
            .addSlider((slider) =>
                slider
                    .setLimits(1, 100, 1)
                    .setValue(this.plugin.settings.compressQuality)
                    .setDynamicTooltip()
                    .onChange(async (value) => {
                        this.plugin.settings.compressQuality = value;
                        await this.plugin.saveSettings();
                    })
            );
    }

    // --- Gallery ---

    private renderGallery(containerEl: HTMLElement) {
        new Setting(containerEl).setName(t('settings.gallery')).setHeading();

        new Setting(containerEl)
            .setName(t('settings.enableImageBrowser'))
            .setDesc(t('settings.enableImageBrowserDesc'))
            .addToggle((toggle) =>
                toggle.setValue(this.plugin.settings.enableImageBrowser).onChange(async (value) => {
                    this.plugin.settings.enableImageBrowser = value;
                    await this.plugin.saveSettings();
                })
            );

        new Setting(containerEl)
            .setName(t('settings.thumbnailSize'))
            .setDesc(t('settings.thumbnailSizeDesc'))
            .addSlider((slider) =>
                slider
                    .setLimits(80, 400, 20)
                    .setValue(this.plugin.settings.thumbnailSize)
                    .setDynamicTooltip()
                    .onChange(async (value) => {
                        this.plugin.settings.thumbnailSize = value;
                        await this.plugin.saveSettings();
                    })
            );
    }

    // --- Image Hosting ---

    private renderImageHosting(containerEl: HTMLElement) {
        new Setting(containerEl).setName(t('settings.imageHosting')).setHeading();

        if (!this.plugin.settings.reorganizeConvertFormat) {
            containerEl.createDiv({
                cls: 'setting-item-description',
                text: t('settings.hostingDisabledByFormat'),
            });
            return;
        }

        // Hosting providers list
        const hostingListEl = containerEl.createDiv({ cls: 'hosting-config-list' });
        this.renderHostingList(hostingListEl);

        // Add button
        new Setting(containerEl)
            .setName(t('settings.addHosting'))
            .setDesc(t('settings.addHostingDesc'))
            .addButton((button) =>
                button.setButtonText('+').onClick(() => {
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
                })
            );

        // Default hosting provider
        const enabledConfigs = this.plugin.settings.hostingConfigs.filter((c) => c.enabled);
        if (enabledConfigs.length > 1) {
            new Setting(containerEl)
                .setName(t('settings.defaultHosting'))
                .setDesc(t('settings.defaultHostingDesc'))
                .addDropdown((dropdown) => {
                    for (const config of enabledConfigs) {
                        dropdown.addOption(config.id, config.name || config.type.toUpperCase());
                    }
                    const currentDefault = this.plugin.settings.defaultHostingId || enabledConfigs[0]!.id;
                    dropdown.setValue(currentDefault).onChange(async (value) => {
                        this.plugin.settings.defaultHostingId = value;
                        await this.plugin.saveSettings();
                    });
                });
        }

        // Upload path template
        new Setting(containerEl)
            .setName(t('settings.uploadPathTemplate'))
            .setDesc(t('settings.uploadPathTemplateDesc'))
            .addText((text) =>
                text
                    .setPlaceholder(DEFAULT_SETTINGS.uploadPathTemplate)
                    .setValue(this.plugin.settings.uploadPathTemplate)
                    .onChange(async (value) => {
                        this.plugin.settings.uploadPathTemplate = value || DEFAULT_SETTINGS.uploadPathTemplate;
                        await this.plugin.saveSettings();
                    })
            );

        new Setting(containerEl)
            .setName(t('settings.autoReplaceAfterUpload'))
            .setDesc(t('settings.autoReplaceAfterUploadDesc'))
            .addToggle((toggle) =>
                toggle.setValue(this.plugin.settings.autoReplaceAfterUpload).onChange(async (value) => {
                    this.plugin.settings.autoReplaceAfterUpload = value;
                    await this.plugin.saveSettings();
                })
            );

        new Setting(containerEl)
            .setName(t('settings.autoUploadOnPaste'))
            .setDesc(t('settings.autoUploadOnPasteDesc'))
            .addToggle((toggle) =>
                toggle.setValue(this.plugin.settings.autoUploadOnPaste).onChange(async (value) => {
                    this.plugin.settings.autoUploadOnPaste = value;
                    await this.plugin.saveSettings();
                })
            );

        new Setting(containerEl)
            .setName(t('settings.keepLocalCopy'))
            .setDesc(t('settings.keepLocalCopyDesc'))
            .addToggle((toggle) =>
                toggle.setValue(this.plugin.settings.keepLocalCopy).onChange(async (value) => {
                    this.plugin.settings.keepLocalCopy = value;
                    await this.plugin.saveSettings();
                })
            );
    }

    private renderHostingList(container: HTMLElement) {
        const configs = this.plugin.settings.hostingConfigs;

        if (configs.length === 0) {
            container.createDiv({
                cls: 'hosting-config-empty',
                text: t('settings.noHosting'),
            });
            return;
        }

        for (const config of configs) {
            const row = container.createDiv({ cls: 'hosting-config-item' });

            // Status indicator
            const statusDot = row.createSpan({
                cls: `hosting-config-status ${config.enabled ? 'hosting-config-status-on' : 'hosting-config-status-off'}`,
            });
            statusDot.setText(config.enabled ? '●' : '○');

            // Name and type
            const info = row.createDiv({ cls: 'hosting-config-info' });
            info.createDiv({ cls: 'hosting-config-name', text: config.name || config.type.toUpperCase() });
            info.createDiv({ cls: 'hosting-config-type', text: config.type });

            const toggleBtn = row.createEl('button', {
                text: config.enabled ? t('settings.disableHosting') : t('settings.enableHosting'),
                cls: `hosting-config-btn hosting-config-toggle-btn ${config.enabled ? 'is-enabled' : 'is-disabled'}`,
                attr: { 'aria-pressed': String(config.enabled) },
            });
            toggleBtn.addEventListener('click', () => {
                config.enabled = !config.enabled;
                if (!config.enabled && this.plugin.settings.defaultHostingId === config.id) {
                    this.plugin.settings.defaultHostingId =
                        configs.find((item) => item.id !== config.id && item.enabled)?.id ?? '';
                }
                void this.plugin.saveSettings().then(() => this.refresh());
            });

            // Edit button
            const editBtn = row.createEl('button', { text: t('settings.editHosting'), cls: 'hosting-config-btn' });
            editBtn.addEventListener('click', () => {
                new HostingConfigModal(this.app, config, (saved) => {
                    const idx = this.plugin.settings.hostingConfigs.findIndex((c) => c.id === saved.id);
                    if (idx >= 0) {
                        this.plugin.settings.hostingConfigs[idx] = saved;
                    }
                    void this.plugin.saveSettings().then(() => this.refresh());
                }).open();
            });

            // Delete button
            const deleteBtn = row.createEl('button', { text: t('settings.deleteHosting'), cls: 'hosting-config-btn mod-warning' });
            deleteBtn.addEventListener('click', () => {
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
            });
        }
    }
}
