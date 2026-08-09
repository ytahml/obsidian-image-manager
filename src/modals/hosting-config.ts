import { App, DropdownComponent, Modal, Setting, TextComponent } from 'obsidian';
import {
    DEFAULT_UPLOAD_PATH_TEMPLATE,
    type ImageHostingConfig,
    type HostingType,
    type AliyunOSSConfig,
    type QiniuConfig,
    type S3Config,
    type CustomConfig,
} from '../types';
import { t } from '../i18n';
import {
    getRemoteManagementConfig,
    isValidPublicUrlAlias,
    normalizePublicUrlAliases,
    normalizeRemotePrefix,
} from '../remote/management-settings';
import { supportsRemoteObjectManagement } from '../remote/provider-factory';

type HostingConfigTab = 'connection' | 'remote';

export class HostingConfigModal extends Modal {
    private config: ImageHostingConfig;
    private onSave: (config: ImageHostingConfig) => void;
    private isNew: boolean;
    private activeTab: HostingConfigTab = 'connection';

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
        this.modalEl.addClass('hosting-config-dialog');
        contentEl.addClass('hosting-config-modal');

        const header = contentEl.createDiv({ cls: 'hosting-config-header' });
        new Setting(header)
            .setName(this.isNew ? t('modal.hosting.addTitle') : t('modal.hosting.editTitle'))
            .setHeading();
        this.renderBasicFields(header);
        if (this.config.type !== 'custom') {
            this.renderUploadFields(header);
        }
        this.renderTabs(contentEl);

        const body = contentEl.createDiv({
            cls: 'hosting-config-body',
            attr: { role: 'tabpanel' },
        });
        switch (this.activeTab) {
            case 'connection':
                this.renderConnectionFields(body);
                break;
            case 'remote':
                this.renderRemoteManagementFields(body);
                break;
        }

        this.renderButtons(contentEl);
    }

    private renderBasicFields(container: HTMLElement) {
        const basic = container.createDiv({ cls: 'hosting-config-basic' });

        const nameId = `hosting-config-name-${this.config.id || 'new'}`;
        const nameRow = basic.createDiv({ cls: 'hosting-config-basic-row' });
        nameRow.createEl('label', {
            cls: 'hosting-config-basic-label',
            text: t('modal.hosting.name'),
            attr: { for: nameId },
        });
        const nameControl = nameRow.createDiv({ cls: 'hosting-config-basic-control' });
        const nameInput = new TextComponent(nameControl).setValue(this.config.name).onChange((value) => {
            this.config.name = value;
        });
        nameInput.inputEl.id = nameId;

        const typeId = `hosting-config-type-${this.config.id || 'new'}`;
        const typeRow = basic.createDiv({ cls: 'hosting-config-basic-row' });
        typeRow.createEl('label', {
            cls: 'hosting-config-basic-label',
            text: t('modal.hosting.type'),
            attr: { for: typeId },
        });
        const typeControl = typeRow.createDiv({ cls: 'hosting-config-basic-control' });
        const typeDropdown = new DropdownComponent(typeControl)
            .addOption('aliyun-oss', 'Aliyun oss')
            .addOption('qiniu', 'Qiniu')
            .addOption('s3', 'S3 compatible')
            .addOption('custom', 'Custom')
            .setValue(this.config.type)
            .onChange((value: string) => {
                this.config.type = value as HostingType;
                this.config.config = this.getDefaultProviderConfig(value as HostingType);
                this.activeTab = 'connection';
                this.renderForm();
            });
        typeDropdown.selectEl.id = typeId;
    }

    private renderTabs(container: HTMLElement) {
        const section = container.createDiv({ cls: 'hosting-config-tabs-section' });
        const tabs = section.createDiv({
            cls: 'hosting-config-tabs',
            attr: { role: 'tablist', 'aria-label': t('modal.hosting.sections') },
        });
        const availableTabs: ReadonlyArray<readonly [HostingConfigTab, string]> = [
            ['connection', t('modal.hosting.tabConnection')],
            ...(supportsRemoteObjectManagement(this.config)
                ? [['remote', t('modal.hosting.tabRemote')] as const]
                : []),
        ];
        for (const [value, label] of availableTabs) {
            const button = tabs.createEl('button', {
                text: label,
                cls: value === this.activeTab ? 'is-active' : '',
                attr: {
                    role: 'tab',
                    'aria-selected': String(value === this.activeTab),
                },
            });
            button.addEventListener('click', () => {
                if (this.activeTab === value) return;
                this.activeTab = value;
                this.renderForm();
            });
        }
    }

    private renderUploadFields(container: HTMLElement) {
        const fields = container.createDiv({ cls: 'hosting-config-field-grid hosting-config-upload-fields' });
        const uploadPath = new Setting(fields)
            .setName(t('modal.hosting.uploadPath'))
            .setDesc(t('modal.hosting.uploadPathDesc'))
            .addText((text) =>
                text
                    .setPlaceholder(DEFAULT_UPLOAD_PATH_TEMPLATE)
                    .setValue(this.config.uploadPath)
                    .onChange((v) => {
                        this.config.uploadPath = v;
                    })
            );
        uploadPath.settingEl.addClass('hosting-config-upload-item');

        const urlPrefix = new Setting(fields)
            .setName(t('modal.hosting.urlPrefix'))
            .setDesc(t('modal.hosting.urlPrefixDesc'))
            .addText((text) =>
                text
                    .setPlaceholder('Img.example.com/bucket')
                    .setValue(this.config.urlPrefix)
                    .onChange((v) => {
                        this.config.urlPrefix = v;
                    })
            );
        urlPrefix.settingEl.addClass('hosting-config-upload-item');
    }

    private renderButtons(container: HTMLElement) {
        const buttons = container.createDiv({ cls: 'hosting-config-buttons' });

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

    private renderRemoteManagementFields(container: HTMLElement) {
        container.createDiv({
            cls: 'setting-item-description',
            text: t('modal.hosting.remoteS3Only'),
        });
        const remote = getRemoteManagementConfig(this.config);
        this.config.remoteManagement = remote;

        new Setting(container)
            .setName(t('modal.hosting.remoteManagementEnabled'))
            .setDesc(t('modal.hosting.remoteManagementEnabledDesc'))
            .addToggle((toggle) =>
                toggle.setValue(remote.enabled).onChange((value) => {
                    remote.enabled = value;
                    this.renderForm();
                })
            );
        if (!remote.enabled) return;
        new Setting(container)
            .setName(t('modal.hosting.remotePrefix'))
            .setDesc(t('modal.hosting.remotePrefixDesc'))
            .addText((text) =>
                text.setValue(remote.prefix).onChange((value) => {
                    remote.prefix = normalizeRemotePrefix(value);
                })
            );
        if (this.config.type === 's3' || this.config.type === 'qiniu') {
            new Setting(container)
                .setName(t('modal.hosting.remotePreviewAccess'))
                .setDesc(t('modal.hosting.remotePreviewAccessDesc'))
                .addDropdown((dropdown) =>
                    dropdown
                        .addOption('presigned', t('modal.hosting.remotePreviewPresigned'))
                        .addOption('public', t('modal.hosting.remotePreviewPublic'))
                        .setValue(remote.previewAccess)
                        .onChange((value) => {
                            remote.previewAccess = value === 'public' ? 'public' : 'presigned';
                            this.renderForm();
                        })
                );
            if (remote.previewAccess === 'public' && !this.config.urlPrefix.trim()) {
                container.createDiv({
                    cls: 'setting-item-description mod-warning',
                    text: t('modal.hosting.remotePreviewPublicWarning'),
                });
            }
        }
        let aliasWarning: HTMLDivElement | undefined;
        const updateAliasWarning = (value: string) => {
            const invalidLines = value.split('\n')
                .map((line, index) => ({ line: line.trim(), number: index + 1 }))
                .filter((item) => item.line && !isValidPublicUrlAlias(item.line))
                .map((item) => String(item.number));
            if (!aliasWarning) return;
            aliasWarning.toggleClass('is-hidden', invalidLines.length === 0);
            aliasWarning.textContent = invalidLines.length === 0
                ? ''
                : t('modal.hosting.remoteAliasesInvalid', { lines: invalidLines.join(', ') });
        };
        const aliasValue = remote.publicUrlAliases.join('\n');
        new Setting(container)
            .setName(t('modal.hosting.remoteAliases'))
            .setDesc(t('modal.hosting.remoteAliasesDesc'))
            .addTextArea((text) => {
                text.inputEl.classList.add('hosting-config-remote-aliases');
                text.inputEl.rows = 3;
                text.setPlaceholder(t('modal.hosting.remoteAliasesPlaceholder'));
                text.setValue(aliasValue).onChange((value) => {
                    remote.publicUrlAliases = normalizePublicUrlAliases(value.split('\n'));
                    updateAliasWarning(value);
                });
            });
        aliasWarning = container.createDiv({
            cls: 'setting-item-description mod-warning is-hidden',
            attr: { role: 'status', 'aria-live': 'polite' },
        });
        updateAliasWarning(aliasValue);
    }

    private renderConnectionFields(container: HTMLElement) {
        this.renderSectionLabel(container, t('modal.hosting.providerConfig'));
        const fields = container.createDiv({ cls: 'hosting-config-field-grid' });
        switch (this.config.type) {
            case 'aliyun-oss':
                this.renderAliyunFields(fields);
                break;
            case 'qiniu':
                this.renderQiniuFields(fields);
                break;
            case 's3':
                this.renderS3Fields(fields);
                break;
            case 'custom':
                this.renderCustomConnectionFields(fields);
                break;
        }
        if (this.config.type === 'custom') {
            this.renderCustomUploadFields(container);
        }
        if (!supportsRemoteObjectManagement(this.config)) {
            container.createDiv({
                cls: 'setting-item-description',
                text: t('modal.hosting.remoteS3Only'),
            });
        }
    }

    private renderSectionLabel(container: HTMLElement, text: string) {
        container.createDiv({
            cls: 'hosting-config-section-label',
            text,
            attr: { role: 'heading', 'aria-level': '3' },
        });
    }

    private renderAliyunFields(container: HTMLElement) {
        const cfg = this.config.config as AliyunOSSConfig;
        new Setting(container)
            .setName(t('modal.hosting.region'))
            .setDesc(t('modal.hosting.aliyunRegionDesc'))
            .addText((text) =>
                text.setValue(cfg.region).onChange((v) => {
                    cfg.region = v;
                })
            );
        new Setting(container)
            .setName(t('modal.hosting.bucket'))
            .addText((text) =>
                text.setValue(cfg.bucket).onChange((v) => {
                    cfg.bucket = v;
                })
            );
        new Setting(container)
            .setName(t('modal.hosting.accessKeyId'))
            .addText((text) =>
                text.setValue(cfg.accessKeyId).onChange((v) => {
                    cfg.accessKeyId = v;
                })
            );
        new Setting(container)
            .setName(t('modal.hosting.accessKeySecret'))
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
            .setName(t('modal.hosting.accessKey'))
            .addText((text) =>
                text.setValue(cfg.accessKey).onChange((v) => {
                    cfg.accessKey = v;
                })
            );
        new Setting(container)
            .setName(t('modal.hosting.secretKey'))
            .addText((text) => {
                text.inputEl.type = 'password';
                text.setValue(cfg.secretKey).onChange((v) => {
                    cfg.secretKey = v;
                });
            });
        new Setting(container)
            .setName(t('modal.hosting.bucket'))
            .addText((text) =>
                text.setValue(cfg.bucket).onChange((v) => {
                    cfg.bucket = v;
                })
            );
        new Setting(container)
            .setName(t('modal.hosting.region'))
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
        const endpoint = new Setting(container)
            .setName(t('modal.hosting.endpoint'))
            .setDesc(t('modal.hosting.endpointDesc'))
            .addText((text) =>
                text.setValue(cfg.endpoint).onChange((v) => {
                    cfg.endpoint = v;
                })
            );
        endpoint.settingEl.addClass('is-wide');
        new Setting(container)
            .setName(t('modal.hosting.region'))
            .setDesc(t('modal.hosting.s3RegionDesc'))
            .addText((text) =>
                text.setValue(cfg.region).onChange((v) => {
                    cfg.region = v;
                })
            );
        new Setting(container)
            .setName(t('modal.hosting.bucket'))
            .addText((text) =>
                text.setValue(cfg.bucket).onChange((v) => {
                    cfg.bucket = v;
                })
            );
        new Setting(container)
            .setName(t('modal.hosting.accessKeyId'))
            .addText((text) =>
                text.setValue(cfg.accessKeyId).onChange((v) => {
                    cfg.accessKeyId = v;
                })
            );
        new Setting(container)
            .setName(t('modal.hosting.secretAccessKey'))
            .addText((text) => {
                text.inputEl.type = 'password';
                text.setValue(cfg.secretAccessKey).onChange((v) => {
                    cfg.secretAccessKey = v;
                });
            });
        new Setting(container)
            .setName(t('modal.hosting.forcePathStyle'))
            .setDesc(t('modal.hosting.forcePathStyleDesc'))
            .addToggle((toggle) =>
                toggle.setValue(cfg.forcePathStyle ?? false).onChange((v) => {
                    cfg.forcePathStyle = v;
                })
            );
    }

    private renderCustomConnectionFields(container: HTMLElement) {
        const cfg = this.config.config as CustomConfig;
        const uploadUrl = new Setting(container)
            .setName(t('modal.hosting.uploadUrl'))
            .addText((text) =>
                text.setValue(cfg.uploadUrl).onChange((v) => {
                    cfg.uploadUrl = v;
                })
            );
        uploadUrl.settingEl.addClass('is-wide');
        new Setting(container)
            .setName(t('modal.hosting.method'))
            .addDropdown((dropdown) =>
                dropdown
                    .addOption('POST', 'POST')
                    .addOption('PUT', 'PUT')
                    .setValue(cfg.method)
                    .onChange((v: string) => {
                        cfg.method = v as 'POST' | 'PUT';
                    })
            );
    }

    private renderCustomUploadFields(container: HTMLElement) {
        const cfg = this.config.config as CustomConfig;
        const fields = container.createDiv({ cls: 'hosting-config-field-grid' });
        new Setting(fields)
            .setName(t('modal.hosting.fileFieldName'))
            .addText((text) =>
                text.setValue(cfg.fileFieldName).onChange((v) => {
                    cfg.fileFieldName = v;
                })
            );
        new Setting(fields)
            .setName(t('modal.hosting.responseJsonPath'))
            .setDesc(t('modal.hosting.jsonPathDesc'))
            .addText((text) =>
                text
                    .setPlaceholder('Data.url')
                    .setValue(cfg.jsonPath)
                    .onChange((v) => {
                        cfg.jsonPath = v;
                    })
            );
        const headers = new Setting(fields)
            .setName(t('modal.hosting.headersJson'))
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
        headers.settingEl.addClass('is-wide');

        const extraBody = new Setting(container)
            .setName(t('modal.hosting.extraBody'))
            .setDesc(t('modal.hosting.extraBodyDesc'));
        const extraBodyContainer = extraBody.controlEl.createDiv({ cls: 'extra-body-container' });
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
