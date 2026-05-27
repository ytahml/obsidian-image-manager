import { App, Modal, Setting } from 'obsidian';
import type { ImageHostingConfig, HostingType, AliyunOSSConfig, QiniuConfig, S3Config, CustomConfig } from '../types';
import { t } from '../i18n';

export class HostingConfigModal extends Modal {
    private config: ImageHostingConfig;
    private onSave: (config: ImageHostingConfig) => void;
    private isNew: boolean;

    constructor(app: App, config: ImageHostingConfig, onSave: (config: ImageHostingConfig) => void) {
        super(app);
        this.config = JSON.parse(JSON.stringify(config));
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
                    .addOption('aliyun-oss', 'Aliyun OSS')
                    .addOption('qiniu', 'Qiniu')
                    .addOption('s3', 'S3 Compatible')
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
            .setDesc('e.g. oss-cn-hangzhou')
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
            .setName('Access Key ID')
            .addText((text) =>
                text.setValue(cfg.accessKeyId).onChange((v) => {
                    cfg.accessKeyId = v;
                })
            );
        new Setting(container)
            .setName('Access Key Secret')
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
            .setName('Access Key')
            .addText((text) =>
                text.setValue(cfg.accessKey).onChange((v) => {
                    cfg.accessKey = v;
                })
            );
        new Setting(container)
            .setName('Secret Key')
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
                    .addOption('z0', 'z0 - 华东（默认）')
                    .addOption('z1', 'z1 - 华北')
                    .addOption('z2', 'z2 - 华南')
                    .addOption('na0', 'na0 - 北美')
                    .addOption('as0', 'as0 - 亚太（新加坡）')
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
            .setName('Access Key ID')
            .addText((text) =>
                text.setValue(cfg.accessKeyId).onChange((v) => {
                    cfg.accessKeyId = v;
                })
            );
        new Setting(container)
            .setName('Secret Access Key')
            .addText((text) => {
                text.inputEl.type = 'password';
                text.setValue(cfg.secretAccessKey).onChange((v) => {
                    cfg.secretAccessKey = v;
                });
            });
        new Setting(container)
            .setName('Force Path Style')
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
            .setName('File Field Name')
            .addText((text) =>
                text.setValue(cfg.fileFieldName).onChange((v) => {
                    cfg.fileFieldName = v;
                })
            );
        new Setting(container)
            .setName('Response JSON Path')
            .setDesc(t('modal.hosting.jsonPathDesc'))
            .addText((text) =>
                text
                    .setPlaceholder('data.url')
                    .setValue(cfg.jsonPath)
                    .onChange((v) => {
                        cfg.jsonPath = v;
                    })
            );
        new Setting(container)
            .setName('Headers (JSON)')
            .addText((text) => {
                text.inputEl.style.fontFamily = 'monospace';
                text.setValue(JSON.stringify(cfg.headers ?? {}, null, 0)).onChange((v) => {
                    try {
                        cfg.headers = JSON.parse(v);
                    } catch {
                        // ignore invalid JSON
                    }
                });
            });
    }

    private getDefaultProviderConfig(type: HostingType): AliyunOSSConfig | QiniuConfig | S3Config | CustomConfig {
        switch (type) {
            case 'aliyun-oss':
                return { region: '', accessKeyId: '', accessKeySecret: '', bucket: '' } as AliyunOSSConfig;
            case 'qiniu':
                return { accessKey: '', secretKey: '', bucket: '', region: 'z0' } as QiniuConfig;
            case 's3':
                return { endpoint: '', region: '', accessKeyId: '', secretAccessKey: '', bucket: '', forcePathStyle: false } as S3Config;
            case 'custom':
                return { uploadUrl: '', method: 'POST' as const, headers: {}, fileFieldName: 'file', jsonPath: 'data.url', extraBody: {} } as CustomConfig;
        }
    }
}
