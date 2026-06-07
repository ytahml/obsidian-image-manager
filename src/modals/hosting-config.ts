import { App, Modal, Setting } from 'obsidian';
import type { ImageHostingConfig, HostingType, AliyunOSSConfig, QiniuConfig, S3Config, CustomConfig } from '../types';
import { t } from '../i18n';

export class HostingConfigModal extends Modal {
    private config: ImageHostingConfig;
    private onSave: (config: ImageHostingConfig) => void;
    private isNew: boolean;

    constructor(app: App, config: ImageHostingConfig, onSave: (config: ImageHostingConfig) => void) {
        super(app);
        this.config = JSON.parse(JSON.stringify(config)) as ImageHostingConfig;
        this.onSave = onSave;
        this.isNew = !config.id;
    }

    onOpen() {
        this.renderForm();
    }

    onClose() {
        this.contentEl.empty();
    }

    private renderForm() {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass('hosting-config-modal');

        contentEl.createEl('h2', {
            text: this.isNew ? t('modal.hosting.addTitle') : t('modal.hosting.editTitle'),
        });

        // Name
        new Setting(contentEl)
            .setName(t('modal.hosting.name'))
            .addText((text) =>
                text.setValue(this.config.name).onChange((v) => {
                    this.config.name = v;
                })
            );

        // Type
        new Setting(contentEl)
            .setName(t('modal.hosting.type'))
            .addDropdown((dropdown) =>
                dropdown
                    .addOption('aliyun-oss', 'Aliyun oss')
                    .addOption('qiniu', 'Qiniu')
                    .addOption('s3', 'S3 compatible')
                    .addOption('custom', 'Custom')
                    .setValue(this.config.type)
                    .onChange((v: string) => {
                        this.config.type = v as HostingType;
                        this.config.config = this.getDefaultProviderConfig(v as HostingType);
                        this.renderForm();
                    })
            );

        // Enabled
        new Setting(contentEl)
            .setName(t('modal.hosting.enabled'))
            .addToggle((toggle) =>
                toggle.setValue(this.config.enabled).onChange((v) => {
                    this.config.enabled = v;
                })
            );

        // Upload path
        new Setting(contentEl)
            .setName(t('modal.hosting.uploadPath'))
            .setDesc(t('modal.hosting.uploadPathDesc'))
            .addText((text) =>
                text
                    .setPlaceholder('images/{year}/{month}/{filename}.{ext}')
                    .setValue(this.config.uploadPath)
                    .onChange((v) => {
                        this.config.uploadPath = v;
                    })
            );

        // URL prefix
        new Setting(contentEl)
            .setName(t('modal.hosting.urlPrefix'))
            .setDesc(t('modal.hosting.urlPrefixDesc'))
            .addText((text) =>
                text
                    .setPlaceholder('https://img.example.com')
                    .setValue(this.config.urlPrefix)
                    .onChange((v) => {
                        this.config.urlPrefix = v;
                    })
            );

        // Provider-specific fields
        contentEl.createEl('h3', { text: t('modal.hosting.providerConfig') });
        this.renderProviderFields(contentEl);

        // Buttons
        const buttons = contentEl.createDiv({ cls: 'hosting-config-buttons' });

        const cancelBtn = buttons.createEl('button', { text: t('modal.confirm.cancel') });
        cancelBtn.addEventListener('click', () => this.close());

        const saveBtn = buttons.createEl('button', { text: t('modal.hosting.save'), cls: 'mod-cta' });
        saveBtn.addEventListener('click', () => {
            if (!this.config.name) {
                this.config.name = this.config.type.toUpperCase();
            }
            this.onSave(this.config);
            this.close();
        });
    }

    private renderProviderFields(container: HTMLElement) {
        switch (this.config.type) {
            case 'aliyun-oss':
                this.renderAliyunFields(container);
                break;
            case 'qiniu':
                this.renderQiniuFields(container);
                break;
            case 's3':
                this.renderS3Fields(container);
                break;
            case 'custom':
                this.renderCustomFields(container);
                break;
        }
    }

    private renderAliyunFields(container: HTMLElement) {
        const cfg = this.config.config as AliyunOSSConfig;
        new Setting(container)
            .setName('Region')
            .setDesc('Example: oss-cn-hangzhou')
            .addText((text) =>
                text.setValue(cfg.region).onChange((v) => {
                    cfg.region = v;
                })
            );
        new Setting(container)
            .setName('Bucket')
            .addText((text) =>
                text.setValue(cfg.bucket).onChange((v) => {
                    cfg.bucket = v;
                })
            );
        new Setting(container)
            .setName('Access key ID')
            .addText((text) =>
                text.setValue(cfg.accessKeyId).onChange((v) => {
                    cfg.accessKeyId = v;
                })
            );
        new Setting(container)
            .setName('Access key secret')
            .addText((text) => {
                text.inputEl.type = 'password';
                text.setValue(cfg.accessKeySecret).onChange((v) => {
                    cfg.accessKeySecret = v;
                });
            });
    }

    private renderQiniuFields(container: HTMLElement) {
        const cfg = this.config.config as QiniuConfig;
        new Setting(container)
            .setName('Access key')
            .addText((text) =>
                text.setValue(cfg.accessKey).onChange((v) => {
                    cfg.accessKey = v;
                })
            );
        new Setting(container)
            .setName('Secret key')
            .addText((text) => {
                text.inputEl.type = 'password';
                text.setValue(cfg.secretKey).onChange((v) => {
                    cfg.secretKey = v;
                });
            });
        new Setting(container)
            .setName('Bucket')
            .addText((text) =>
                text.setValue(cfg.bucket).onChange((v) => {
                    cfg.bucket = v;
                })
            );
        new Setting(container)
            .setName('Region')
            .setDesc(t('modal.hosting.qiniuRegionDesc'))
            .addDropdown((dropdown) =>
                dropdown
                    .addOption('z0', t('modal.hosting.qiniuRegion.z0'))
                    .addOption('z1', t('modal.hosting.qiniuRegion.z1'))
                    .addOption('z2', t('modal.hosting.qiniuRegion.z2'))
                    .addOption('na0', t('modal.hosting.qiniuRegion.na0'))
                    .addOption('as0', t('modal.hosting.qiniuRegion.as0'))
                    .setValue(cfg.region || 'z0')
                    .onChange((v: string) => {
                        cfg.region = v;
                    })
            );
    }

    private renderS3Fields(container: HTMLElement) {
        const cfg = this.config.config as S3Config;
        new Setting(container)
            .setName('Endpoint')
            .setDesc('e.g. https://s3.amazonaws.com')
            .addText((text) =>
                text.setValue(cfg.endpoint).onChange((v) => {
                    cfg.endpoint = v;
                })
            );
        new Setting(container)
            .setName('Region')
            .addText((text) =>
                text.setValue(cfg.region).onChange((v) => {
                    cfg.region = v;
                })
            );
        new Setting(container)
            .setName('Bucket')
            .addText((text) =>
                text.setValue(cfg.bucket).onChange((v) => {
                    cfg.bucket = v;
                })
            );
        new Setting(container)
            .setName('Access key ID')
            .addText((text) =>
                text.setValue(cfg.accessKeyId).onChange((v) => {
                    cfg.accessKeyId = v;
                })
            );
        new Setting(container)
            .setName('Secret access key')
            .addText((text) => {
                text.inputEl.type = 'password';
                text.setValue(cfg.secretAccessKey).onChange((v) => {
                    cfg.secretAccessKey = v;
                });
            });
        new Setting(container)
            .setName('Force path style')
            .setDesc(t('modal.hosting.forcePathStyleDesc'))
            .addToggle((toggle) =>
                toggle.setValue(cfg.forcePathStyle ?? false).onChange((v) => {
                    cfg.forcePathStyle = v;
                })
            );
    }

    private renderCustomFields(container: HTMLElement) {
        const cfg = this.config.config as CustomConfig;
        new Setting(container)
            .setName('Upload URL')
            .addText((text) =>
                text.setValue(cfg.uploadUrl).onChange((v) => {
                    cfg.uploadUrl = v;
                })
            );
        new Setting(container)
            .setName('Method')
            .addDropdown((dropdown) =>
                dropdown
                    .addOption('POST', 'POST')
                    .addOption('PUT', 'PUT')
                    .setValue(cfg.method)
                    .onChange((v: string) => {
                        cfg.method = v as 'POST' | 'PUT';
                    })
            );
        new Setting(container)
            .setName('File field name')
            .addText((text) =>
                text.setValue(cfg.fileFieldName).onChange((v) => {
                    cfg.fileFieldName = v;
                })
            );
        new Setting(container)
            .setName('Response JSON path')
            .setDesc(t('modal.hosting.jsonPathDesc'))
            .addText((text) =>
                text
                    .setPlaceholder('Data.url')
                    .setValue(cfg.jsonPath)
                    .onChange((v) => {
                        cfg.jsonPath = v;
                    })
            );
        new Setting(container)
            .setName('Headers (JSON)')
            .addText((text) => {
                text.inputEl.classList.add('hosting-config-monospace');
                text.setValue(JSON.stringify(cfg.headers ?? {}, null, 0)).onChange((v) => {
                    try {
                        cfg.headers = JSON.parse(v) as Record<string, string>;
                    } catch {
                        // ignore invalid JSON
                    }
                });
            });

        // Extra body fields (key-value pairs)
        new Setting(container)
            .setName(t('modal.hosting.extraBody'))
            .setDesc(t('modal.hosting.extraBodyDesc'));

        const extraBodyContainer = container.createDiv({ cls: 'extra-body-container' });
        this.renderExtraBodyFields(extraBodyContainer, cfg);
    }

    private renderExtraBodyFields(container: HTMLElement, cfg: CustomConfig) {
        container.empty();
        const extraBody = cfg.extraBody ?? {};
        const entries = Object.entries(extraBody);

        for (let i = 0; i < entries.length; i++) {
            const [key, value] = entries[i]!;
            const row = container.createDiv({ cls: 'extra-body-row' });

            const keyInput = row.createEl('input', {
                type: 'text',
                placeholder: t('modal.hosting.extraBodyKey'),
                value: key,
                cls: 'extra-body-key-input',
            });

            const valueInput = row.createEl('input', {
                type: 'text',
                placeholder: t('modal.hosting.extraBodyValue'),
                value: value,
                cls: 'extra-body-value-input',
            });

            const removeBtn = row.createEl('button', { text: '×', cls: 'extra-body-remove-btn' });
            removeBtn.addEventListener('click', () => {
                delete cfg.extraBody[key];
                this.renderExtraBodyFields(container, cfg);
            });

            // Update on change
            keyInput.addEventListener('change', () => {
                const oldKey = key;
                const newKey = keyInput.value;
                if (newKey && newKey !== oldKey) {
                    delete cfg.extraBody[oldKey];
                    cfg.extraBody[newKey] = valueInput.value;
                }
            });
            valueInput.addEventListener('change', () => {
                cfg.extraBody[keyInput.value] = valueInput.value;
            });
        }

        // Add button
        const addRow = container.createDiv({ cls: 'extra-body-row' });
        const addBtn = addRow.createEl('button', { text: `+ ${t('modal.hosting.extraBodyAdd')}` });
        addBtn.addEventListener('click', () => {
            cfg.extraBody[`field_${Date.now()}`] = '';
            this.renderExtraBodyFields(container, cfg);
        });
    }

    private getDefaultProviderConfig(type: HostingType): AliyunOSSConfig | QiniuConfig | S3Config | CustomConfig {
        switch (type) {
            case 'aliyun-oss':
                return { region: '', accessKeyId: '', accessKeySecret: '', bucket: '' };
            case 'qiniu':
                return { accessKey: '', secretKey: '', bucket: '', region: 'z0' };
            case 's3':
                return { endpoint: '', region: '', accessKeyId: '', secretAccessKey: '', bucket: '', forcePathStyle: false };
            case 'custom':
                return { uploadUrl: '', method: 'POST' as const, headers: {}, fileFieldName: 'file', jsonPath: 'data.url', extraBody: {} };
        }
    }
}
