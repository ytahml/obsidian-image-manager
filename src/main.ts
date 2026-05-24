import { Notice, Plugin, TFile, MarkdownView, SuggestModal } from 'obsidian';
import { ImageManagerSettings, DEFAULT_SETTINGS, ImageHostingConfig } from './types';
import { ImageManagerSettingTab } from './settings';
import { ImageBrowserModal } from './modals/image-browser';
import { OrphanImagesModal } from './modals/orphan-images';
import { RenameImageModal } from './modals/rename-image';
import { RefConverter } from './utils/ref-converter';
import { ImageOptimizer } from './utils/image-optimizer';
import { ImageScanner } from './utils/image-scanner';
import { BatchRename } from './utils/batch-rename';
import { createUploader } from './uploaders/uploader-factory';
import { UploadQueue } from './uploaders/upload-queue';
import { setLocale, t } from './i18n';

export default class ImageManagerPlugin extends Plugin {
    settings: ImageManagerSettings;
    refConverter: RefConverter;
    imageOptimizer: ImageOptimizer;
    batchRename: BatchRename;

    async onload() {
        await this.loadSettings();
        setLocale(this.settings.locale);

        this.refConverter = new RefConverter(this.app);
        this.imageOptimizer = new ImageOptimizer(this.app);
        this.batchRename = new BatchRename(this.app);

        // Ribbon icon
        this.addRibbonIcon('image', t('ribbon.tooltip'), () => {
            new ImageBrowserModal(this.app, this).open();
        });

        // Commands
        this.addCommand({
            id: 'browse-images',
            name: t('command.browseImages'),
            callback: () => {
                new ImageBrowserModal(this.app, this).open();
            },
        });

        this.addCommand({
            id: 'compress-current-image',
            name: t('command.compressImage'),
            checkCallback: (checking) => {
                const file = this.app.workspace.getActiveFile();
                if (!file || !this.isImageFile(file)) return false;
                if (!checking) this.compressCurrentImage(file);
                return true;
            },
        });

        this.addCommand({
            id: 'convert-reference-format',
            name: t('command.convertReference'),
            callback: () => this.convertCurrentNote(),
        });

        this.addCommand({
            id: 'convert-reference-format-vault',
            name: t('command.convertReferenceVault'),
            callback: () => this.convertEntireVault(),
        });

        this.addCommand({
            id: 'upload-to-hosting',
            name: t('command.uploadToHosting'),
            callback: () => this.uploadCurrentImage(),
        });

        this.addCommand({
            id: 'batch-upload',
            name: t('command.batchUpload'),
            callback: () => this.batchUpload(),
        });

        this.addCommand({
            id: 'find-orphan-images',
            name: t('command.findOrphans'),
            callback: () => {
                new OrphanImagesModal(this.app, this).open();
            },
        });

        this.addCommand({
            id: 'rename-image',
            name: t('command.renameImage'),
            checkCallback: (checking) => {
                const file = this.app.workspace.getActiveFile();
                if (!file || !this.isImageFile(file)) return false;
                if (!checking) this.renameImage(file);
                return true;
            },
        });

        this.addCommand({
            id: 'migrate-images',
            name: t('command.migrateImages'),
            callback: () => {
                new Notice(`${t('command.migrateImages')} - ${t('notice.notImplemented')}`);
            },
        });

        // Settings tab
        this.addSettingTab(new ImageManagerSettingTab(this.app, this));
    }

    onunload() {}

    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    }

    async saveSettings() {
        await this.saveData(this.settings);
    }

    private isImageFile(file: TFile): boolean {
        const scanner = new ImageScanner(this.app, this.settings.supportedExtensions);
        return scanner.isImageFile(file);
    }

    private async compressCurrentImage(file: TFile) {
        try {
            const result = await this.imageOptimizer.compressImage(file, this.settings.compressQuality);
            if (result.optimizedSize >= result.originalSize) {
                new Notice(t('notice.compressNoGain'));
                return;
            }

            const savedPercent = ((1 - result.optimizedSize / result.originalSize) * 100).toFixed(1);
            await this.app.vault.modifyBinary(file, result.data);
            new Notice(t('notice.compressSuccess', { saved: savedPercent }));
        } catch (e) {
            new Notice(t('notice.compressFailed'));
            console.error('Image compression failed:', e);
        }
    }

    private async convertCurrentNote() {
        const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);

        if (!activeView?.file) {
            new Notice(t('notice.noActiveEditor'));
            return;
        }

        const file = activeView.file;
        const content = await this.app.vault.cachedRead(file);
        const counts = this.refConverter.countReferences(content);

        const currentFormat = this.settings.referenceFormat;
        const targetFormat = currentFormat === 'wiki' ? 'markdown' : 'wiki';

        const refCount = targetFormat === 'wiki' ? counts.markdown : counts.wiki;
        if (refCount === 0) {
            new Notice(t('notice.noRefsToConvert'));
            return;
        }

        const converted = this.refConverter.convertAllReferences(content, targetFormat);
        await this.app.vault.process(file, () => converted);
        new Notice(t('notice.convertSuccess', { count: String(refCount) }));
    }

    private async convertEntireVault() {
        const mdFiles = this.app.vault.getMarkdownFiles();
        const targetFormat = this.settings.referenceFormat === 'wiki' ? 'markdown' : 'wiki';

        let totalConverted = 0;
        let filesChanged = 0;

        for (const file of mdFiles) {
            const content = await this.app.vault.cachedRead(file);
            const counts = this.refConverter.countReferences(content);
            const refCount = targetFormat === 'wiki' ? counts.markdown : counts.wiki;

            if (refCount === 0) continue;

            const converted = this.refConverter.convertAllReferences(content, targetFormat);
            await this.app.vault.process(file, () => converted);
            totalConverted += refCount;
            filesChanged++;
        }

        if (filesChanged === 0) {
            new Notice(t('notice.noRefsToConvert'));
        } else {
            new Notice(t('notice.convertVaultSuccess', { files: String(filesChanged), count: String(totalConverted) }));
        }
    }

    private async uploadCurrentImage() {
        const file = this.app.workspace.getActiveFile();
        if (!file || !this.isImageFile(file)) {
            new Notice(t('notice.noActiveEditor'));
            return;
        }

        const configs = this.settings.hostingConfigs.filter((c) => c.enabled);
        if (configs.length === 0) {
            new Notice(t('notice.noHostingConfig'));
            return;
        }

        if (configs.length === 1) {
            await this.doUpload(file, configs[0]!);
        } else {
            new HostingSuggestModal(this.app, configs, (config) => {
                this.doUpload(file, config);
            }).open();
        }
    }

    private async batchUpload() {
        const scanner = new ImageScanner(this.app, this.settings.supportedExtensions);
        const images = scanner.getAllImages();

        if (images.length === 0) {
            new Notice(t('notice.noImagesToUpload'));
            return;
        }

        const configs = this.settings.hostingConfigs.filter((c) => c.enabled);
        if (configs.length === 0) {
            new Notice(t('notice.noHostingConfig'));
            return;
        }

        const doBatch = async (hostingConfig: ImageHostingConfig) => {
            new Notice(t('notice.batchUploadStart', { count: String(images.length) }));

            const queue = new UploadQueue(this.app, this.settings);
            queue.addFiles(images);

            queue.onProgressChange((progress) => {
                new Notice(
                    t('notice.batchUploadProgress', {
                        done: String(progress.completed),
                        total: String(progress.total),
                        current: progress.current,
                    }),
                    2000
                );
            });

            const history = await queue.start(hostingConfig);

            new Notice(
                t('notice.batchUploadDone', {
                    success: String(history.length),
                    total: String(images.length),
                })
            );
        };

        if (configs.length === 1) {
            await doBatch(configs[0]!);
        } else {
            new HostingSuggestModal(this.app, configs, (config) => {
                doBatch(config);
            }).open();
        }
    }

    private async doUpload(file: TFile, hostingConfig: ImageHostingConfig) {
        new Notice(t('notice.uploading'));

        try {
            let data = await this.app.vault.readBinary(file);

            if (this.settings.autoCompress) {
                const result = await this.imageOptimizer.compressImage(file, this.settings.compressQuality);
                data = result.data;
            }

            const uploader = createUploader(hostingConfig);
            const result = await uploader.upload(data, file.name);

            if (result.success && result.url) {
                new Notice(t('notice.uploadSuccess', { url: result.url }));
                await navigator.clipboard.writeText(result.url);

                if (this.settings.autoReplaceAfterUpload) {
                    await this.replaceReferenceInNote(file, result.url);
                }
            } else {
                new Notice(t('notice.uploadFailed', { error: result.error ?? 'Unknown error' }));
            }
        } catch (e) {
            new Notice(t('notice.uploadFailed', { error: e instanceof Error ? e.message : 'Unknown error' }));
        }
    }

    private async replaceReferenceInNote(imageFile: TFile, newUrl: string) {
        const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (!activeView?.file) return;

        const content = await this.app.vault.cachedRead(activeView.file);
        const refs = this.refConverter.parseReferences(content);

        const imageName = imageFile.name;
        const imagePath = imageFile.path;
        let replaced = false;
        let newContent = content;

        for (let i = refs.length - 1; i >= 0; i--) {
            const ref = refs[i]!;
            const refName = ref.path.split('/').pop() ?? ref.path;
            if (refName === imageName || ref.path === imagePath) {
                const newRef = `![${ref.altText || imageName}](${newUrl})`;
                newContent = newContent.substring(0, ref.col) + newRef + newContent.substring(ref.col + ref.fullMatch.length);
                replaced = true;
            }
        }

        if (replaced) {
            await this.app.vault.process(activeView.file, () => newContent);
        }
    }

    private renameImage(file: TFile) {
        new RenameImageModal(this.app, file, async (newName) => {
            try {
                const result = await this.batchRename.renameImage(file, newName);
                new Notice(
                    t('notice.renameSuccess', {
                        old: result.oldName,
                        new: result.newName,
                        notes: String(result.notesUpdated),
                    })
                );
            } catch (e) {
                new Notice(t('notice.renameFailed', { error: e instanceof Error ? e.message : 'Unknown error' }));
            }
        }).open();
    }
}

class HostingSuggestModal extends SuggestModal<ImageHostingConfig> {
    private configs: ImageHostingConfig[];
    private onChoose: (config: ImageHostingConfig) => void;

    constructor(
        app: import('obsidian').App,
        configs: ImageHostingConfig[],
        onChoose: (config: ImageHostingConfig) => void
    ) {
        super(app);
        this.configs = configs;
        this.onChoose = onChoose;
    }

    getSuggestions(query: string): ImageHostingConfig[] {
        return this.configs.filter(
            (c) => c.name.toLowerCase().includes(query.toLowerCase()) || c.type.includes(query.toLowerCase())
        );
    }

    renderSuggestion(config: ImageHostingConfig, el: HTMLElement) {
        el.createDiv({ text: config.name });
        el.createDiv({ text: config.type, cls: 'suggestion-note' });
    }

    onChooseItem(config: ImageHostingConfig) {
        this.onChoose(config);
    }

    onChooseSuggestion(config: ImageHostingConfig) {
        this.onChoose(config);
    }
}
