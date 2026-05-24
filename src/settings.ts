import { App, PluginSettingTab, Setting } from 'obsidian';
import type ImageManagerPlugin from './main';
import { DEFAULT_SETTINGS } from './types';
import { t, setLocale, type Locale } from './i18n';

export class ImageManagerSettingTab extends PluginSettingTab {
    plugin: ImageManagerPlugin;

    constructor(app: App, plugin: ImageManagerPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const { containerEl } = this;
        containerEl.empty();

        containerEl.createEl('h2', { text: t('settings.title') });

        // --- Language ---
        containerEl.createEl('h3', { text: t('settings.language') });

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
                        this.display();
                    })
            );

        // --- General ---
        containerEl.createEl('h3', { text: t('settings.general') });

        new Setting(containerEl)
            .setName(t('settings.imageDirectory'))
            .setDesc(t('settings.imageDirectoryDesc'))
            .addText((text) =>
                text
                    .setPlaceholder(DEFAULT_SETTINGS.imageDirectory)
                    .setValue(this.plugin.settings.imageDirectory)
                    .onChange(async (value) => {
                        this.plugin.settings.imageDirectory = value || DEFAULT_SETTINGS.imageDirectory;
                        await this.plugin.saveSettings();
                    })
            );

        new Setting(containerEl)
            .setName(t('settings.referenceFormat'))
            .setDesc(t('settings.referenceFormatDesc'))
            .addDropdown((dropdown) =>
                dropdown
                    .addOption('wiki', t('settings.referenceFormat.wiki'))
                    .addOption('markdown', t('settings.referenceFormat.markdown'))
                    .setValue(this.plugin.settings.referenceFormat)
                    .onChange(async (value: string) => {
                        this.plugin.settings.referenceFormat = value as 'wiki' | 'markdown';
                        await this.plugin.saveSettings();
                    })
            );

        // --- Compression ---
        containerEl.createEl('h3', { text: t('settings.compression') });

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

        // --- Thumbnail ---
        containerEl.createEl('h3', { text: t('settings.gallery') });

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

        // --- Image Hosting ---
        containerEl.createEl('h3', { text: t('settings.imageHosting') });

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
    }
}
