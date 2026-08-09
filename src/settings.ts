import { App, PluginSettingTab, Setting, type SettingDefinitionItem } from 'obsidian';
import type ImageManagerPlugin from './main';
import { DEFAULT_SETTINGS, ImageHostingConfig } from './types';
import { t, setLocale } from './i18n';
import { HostingConfigModal } from './modals/hosting-config';
import { ConfirmDialog } from './modals/confirm-dialog';
import { validateReferenceTemplate } from './utils/reference-template';

export class ImageManagerSettingTab extends PluginSettingTab {
    plugin: ImageManagerPlugin;

    constructor(app: App, plugin: ImageManagerPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    async setControlValue(key: string, value: unknown): Promise<void> {
        let nextValue = value;
        if (typeof value === 'string') {
            if (key === 'imagePathTemplate') nextValue = value || DEFAULT_SETTINGS.imagePathTemplate;
            if (key === 'imageNamingTemplate') nextValue = value || DEFAULT_SETTINGS.imageNamingTemplate;
        }

        await super.setControlValue(key, nextValue);

        if (key === 'locale' && (nextValue === 'en' || nextValue === 'zh')) {
            setLocale(nextValue);
            this.update();
        } else if (key === 'localManagementMode') {
            this.plugin.cancelDelegatedTransactions();
            this.update();
        }
    }

    private managedSettingDesc(descKey: Parameters<typeof t>[0]): string {
        const desc = t(descKey);
        return this.plugin.settings.localManagementMode === 'delegated'
            ? `${desc} ${t('settings.delegatedManagedControlDesc')}`
            : desc;
    }

    private isDelegated(): boolean {
        return this.plugin.settings.localManagementMode === 'delegated';
    }

    getSettingDefinitions(): SettingDefinitionItem[] {
        return [
            {
                name: t('settings.language'),
                desc: t('settings.languageDesc'),
                control: {
                    type: 'dropdown',
                    key: 'locale',
                    options: { en: 'English', zh: '中文' },
                },
            },
            {
                type: 'group',
                heading: t('settings.general'),
                items: [
                    {
                        name: t('settings.localManagementMode'),
                        desc: t('settings.localManagementModeDesc'),
                        control: {
                            type: 'dropdown',
                            key: 'localManagementMode',
                            options: {
                                managed: t('settings.localManagementMode.managed'),
                                delegated: t('settings.localManagementMode.delegated'),
                            },
                        },
                    },
                    {
                        name: t('settings.imagePathTemplate'),
                        desc: this.managedSettingDesc('settings.imagePathTemplateDesc'),
                        control: {
                            type: 'text',
                            key: 'imagePathTemplate',
                            placeholder: DEFAULT_SETTINGS.imagePathTemplate,
                            disabled: () => this.isDelegated(),
                        },
                    },
                    {
                        name: t('settings.imagePathBase'),
                        desc: this.managedSettingDesc('settings.imagePathBaseDesc'),
                        control: {
                            type: 'dropdown',
                            key: 'imagePathBase',
                            options: {
                                vault: t('settings.imagePathBase.vault'),
                                note: t('settings.imagePathBase.note'),
                            },
                            disabled: () => this.isDelegated(),
                        },
                    },
                    {
                        name: t('settings.managedPasteReferenceFormat'),
                        desc: this.managedSettingDesc('settings.managedPasteReferenceFormatDesc'),
                        control: {
                            type: 'dropdown',
                            key: 'managedPasteReferenceFormat',
                            options: {
                                markdown: t('settings.managedPasteReferenceFormat.markdown'),
                                wiki: t('settings.managedPasteReferenceFormat.wiki'),
                            },
                            disabled: () => this.isDelegated(),
                        },
                    },
                    {
                        name: t('settings.reorganizeConvertFormat'),
                        desc: t('settings.reorganizeConvertFormatDesc'),
                        control: { type: 'toggle', key: 'reorganizeConvertFormat' },
                    },
                    {
                        name: t('settings.skipWikiRefsOnReorganize'),
                        desc: t('settings.skipWikiRefsOnReorganizeDesc'),
                        control: { type: 'toggle', key: 'skipWikiRefsOnReorganize' },
                    },
                ],
            },
            {
                type: 'group',
                heading: t('settings.imageNaming'),
                items: [
                    {
                        name: t('settings.imageNamingTemplate'),
                        desc: this.managedSettingDesc('settings.imageNamingTemplateDesc'),
                        control: {
                            type: 'text',
                            key: 'imageNamingTemplate',
                            placeholder: DEFAULT_SETTINGS.imageNamingTemplate,
                            disabled: () => this.isDelegated(),
                        },
                    },
                    {
                        name: t('settings.promptImageName'),
                        desc: this.managedSettingDesc('settings.promptImageNameDesc'),
                        control: {
                            type: 'toggle',
                            key: 'promptImageName',
                            disabled: () => this.isDelegated(),
                        },
                    },
                ],
            },
            {
                type: 'group',
                heading: t('settings.compression'),
                items: [
                    {
                        name: t('settings.compressManagedPasteLocal'),
                        desc: this.managedSettingDesc('settings.compressManagedPasteLocalDesc'),
                        control: {
                            type: 'toggle',
                            key: 'compressManagedPasteLocal',
                            disabled: () => this.isDelegated(),
                        },
                    },
                    {
                        name: t('settings.compressBeforeUpload'),
                        desc: t('settings.compressBeforeUploadDesc'),
                        control: { type: 'toggle', key: 'compressBeforeUpload' },
                    },
                    {
                        name: t('settings.compressQuality'),
                        desc: t('settings.compressQualityDesc'),
                        control: { type: 'slider', key: 'compressQuality', min: 1, max: 100, step: 1 },
                    },
                ],
            },
            {
                type: 'group',
                heading: t('settings.gallery'),
                items: [
                    {
                        name: t('settings.enableImageBrowser'),
                        desc: t('settings.enableImageBrowserDesc'),
                        control: { type: 'toggle', key: 'enableImageBrowser' },
                    },
                    {
                        name: t('settings.thumbnailSize'),
                        desc: t('settings.thumbnailSizeDesc'),
                        control: { type: 'slider', key: 'thumbnailSize', min: 80, max: 400, step: 20 },
                    },
                ],
            },
            {
                name: t('settings.imageHosting'),
                aliases: [
                    t('settings.addHosting'),
                    t('settings.defaultHosting'),
                    t('settings.uploadPathTemplate'),
                    t('settings.customReferenceTemplate'),
                    t('settings.autoReplaceAfterUpload'),
                    t('settings.autoUploadOnPaste'),
                    t('settings.keepLocalCopy'),
                ],
                render: (setting) => {
                    setting.settingEl.empty();
                    setting.settingEl.addClass('image-hosting-settings-wrapper');
                    this.renderImageHosting(setting.settingEl);
                },
            },
        ];
    }

    // --- Image Hosting ---

    private renderImageHosting(containerEl: HTMLElement) {
        new Setting(containerEl).setName(t('settings.imageHosting')).setHeading();

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
                        void this.plugin.saveSettings().then(() => this.update());
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

        // Custom reference template applied to references generated after upload
        const customReferenceSetting = new Setting(containerEl)
            .setName(t('settings.customReferenceTemplate'))
            .setDesc(t('settings.customReferenceTemplateDesc'));
        const validationEl = customReferenceSetting.descEl.createDiv({
            cls: 'custom-reference-template-validation',
        });
        const updateValidation = (value: string) => {
            const validation = validateReferenceTemplate(value);
            validationEl.removeClass('is-invalid');
            if (validation.status !== 'invalid') {
                validationEl.textContent = '';
                return;
            }

            validationEl.addClass('is-invalid');
            validationEl.textContent = validation.reason === 'missing-file-url'
                ? t('settings.customReferenceTemplateMissingUrl')
                : t('settings.customReferenceTemplateUnknownVariables', {
                    variables: validation.unknownVariables.map((name) => `{${name}}`).join(', '),
                });
        };
        updateValidation(this.plugin.settings.customReferenceTemplate);
        customReferenceSetting.addText((text) => {
            text
                .setPlaceholder(t('settings.customReferenceTemplatePlaceholder'))
                .setValue(this.plugin.settings.customReferenceTemplate)
                .onChange(async (value) => {
                    this.plugin.settings.customReferenceTemplate = value;
                    updateValidation(value);
                    await this.plugin.saveSettings();
                });
        });

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
                toggle.setDisabled(this.plugin.settings.hostingConfigs.every((config) => !config.enabled))
                    .setValue(this.plugin.settings.autoUploadOnPaste).onChange(async (value) => {
                    this.plugin.settings.autoUploadOnPaste = value;
                    if (!value) this.plugin.cancelDelegatedTransactions();
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
                void this.plugin.saveSettings().then(() => this.update());
            });

            // Edit button
            const editBtn = row.createEl('button', { text: t('settings.editHosting'), cls: 'hosting-config-btn' });
            editBtn.addEventListener('click', () => {
                new HostingConfigModal(this.app, config, (saved) => {
                    const idx = this.plugin.settings.hostingConfigs.findIndex((c) => c.id === saved.id);
                    if (idx >= 0) {
                        this.plugin.settings.hostingConfigs[idx] = saved;
                    }
                    void this.plugin.saveSettings().then(() => this.update());
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
                        this.update();
                    },
                }).open();
            });
        }
    }
}
