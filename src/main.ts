import { Notice, Plugin, TAbstractFile, TFile, TFolder, MarkdownView, SuggestModal } from 'obsidian';
import { ImageManagerSettings, ImageHostingConfig, normalizeImageManagerSettings } from './types';
import { ImageManagerSettingTab } from './settings';
import { ImageBrowserModal } from './modals/image-browser';
import { OrphanImagesModal } from './modals/orphan-images';
import { RenameImageModal } from './modals/rename-image';
import { RefConverter } from './utils/ref-converter';
import { ImageOptimizer } from './utils/image-optimizer';
import { ImageScanner } from './utils/image-scanner';
import { BatchRename } from './utils/batch-rename';
import { ImageReorganizer } from './utils/image-reorganizer';
import { UploadService } from './uploaders/upload-service';
import { ExplicitUploadWorkflow } from './uploaders/explicit-upload-workflow';
import { UploadReferenceManager } from './uploaders/upload-reference-manager';
import { setLocale, t } from './i18n';
import { RemoteReferenceIndex } from './remote/reference-index';
import type { RemoteDeleteAuditEntry } from './remote/types';
import { normalizeRemoteDeleteHistory, RemoteDeleteAuditWriter } from './remote/delete-audit';
import { ObsidianDelegatedHandoff } from './lifecycle/obsidian-delegated-handoff';
import { ExternalRenameRepairCoordinator } from './lifecycle/external-rename-repair-coordinator';
import { IndeterminateImageRegistry } from './lifecycle/indeterminate-image-registry';
import { ConfirmDialog } from './modals/confirm-dialog';
import { ManagedPastePipeline } from './lifecycle/managed-paste-pipeline';

export default class ImageManagerPlugin extends Plugin {
    settings: ImageManagerSettings;
    refConverter: RefConverter;
    imageOptimizer: ImageOptimizer;
    batchRename: BatchRename;
    remoteReferenceIndex: RemoteReferenceIndex;
    uploadService: UploadService;
    private uploadReferences: UploadReferenceManager;
    private explicitUploads: ExplicitUploadWorkflow;
    private delegatedHandoff: ObsidianDelegatedHandoff;
    private isReorganizing = false;
    private renameRepairCoordinator: ExternalRenameRepairCoordinator<TFile>;
    private indeterminateImages: IndeterminateImageRegistry<TFile>;
    private remoteDeleteAuditWriter: RemoteDeleteAuditWriter;
    private managedPastePipeline: ManagedPastePipeline;
    async onload() {
        await this.loadSettings();
        setLocale(this.settings.locale);

        this.refConverter = new RefConverter(this.app);
        this.imageOptimizer = new ImageOptimizer(this.app);
        this.uploadService = new UploadService(this.app, () => this.settings);
        this.uploadReferences = new UploadReferenceManager({
            app: this.app,
            refConverter: this.refConverter,
            getDefaultTemplate: () => this.settings.customReferenceTemplate,
            getImageInfo: (file) => this.imageOptimizer.getImageInfo(file),
            onImageInfoError: (file, error) => {
                console.warn(`[ImageManager] Failed to read image dimensions for ${file.path}:`, error);
            },
        });
        this.explicitUploads = new ExplicitUploadWorkflow(
            this.app,
            this.uploadService,
            this.refConverter,
            this.uploadReferences
        );
        this.batchRename = new BatchRename(this.app, this.settings);
        this.indeterminateImages = new IndeterminateImageRegistry<TFile>({
            schedule: (delay, callback) => window.setTimeout(callback, delay),
            cancel: (id) => window.clearTimeout(id),
        });
        this.renameRepairCoordinator = new ExternalRenameRepairCoordinator<TFile>(
            {
                schedule: (delay, callback) => window.setTimeout(callback, delay),
                cancel: (id) => window.clearTimeout(id),
            },
            (entries) => this.batchRename.fixBrokenImageRefsBatch(entries),
            2_000,
            (file) => !this.delegatedHandoff.isTrackingFile(file) &&
                !this.indeterminateImages.paths().has(file.path) &&
                this.app.vault.getAbstractFileByPath(file.path) === file
        );
        this.remoteReferenceIndex = new RemoteReferenceIndex(this.app, this.refConverter);
        this.remoteDeleteAuditWriter = new RemoteDeleteAuditWriter(
            () => this.settings.remoteDeleteHistory,
            (history) => { this.settings.remoteDeleteHistory = history; },
            () => this.saveSettings()
        );
        this.delegatedHandoff = new ObsidianDelegatedHandoff({
            app: this.app,
            getSettings: () => this.settings,
            uploadService: this.uploadService,
            refConverter: this.refConverter,
            isImageFile: (file) => this.isImageFile(file),
            uploadReferences: this.uploadReferences,
            getDefaultHostingConfig: () => this.getDefaultHostingConfig(),
            notice: (message, timeout) => new Notice(message, timeout),
            beginIndeterminate: (file) => this.indeterminateImages.begin(file, file.path),
            touchIndeterminate: (file) => this.indeterminateImages.touch(file, file.path),
            endIndeterminate: (file) => this.indeterminateImages.end(file, file.path),
            isIndeterminate: (file) => this.indeterminateImages.paths().has(file.path),
        });
        this.managedPastePipeline = new ManagedPastePipeline({
            app: this.app,
            getSettings: () => this.settings,
            uploadService: this.uploadService,
            refConverter: this.refConverter,
            uploadReferences: this.uploadReferences,
            getDefaultHostingConfig: () => this.getDefaultHostingConfig(),
            getIndeterminateImagePaths: () => this.getIndeterminateImagePaths(),
        });

        // Ribbon icon
        if (this.settings.enableImageBrowser) {
            this.addRibbonIcon('image', t('ribbon.tooltip'), () => {
                new ImageBrowserModal(this.app, this).open();
            });
        }

        // Commands
        this.addCommand({
            id: 'browse-images',
            name: t('command.browseImages'),
            checkCallback: (checking) => {
                if (!this.settings.enableImageBrowser) return false;
                if (!checking) new ImageBrowserModal(this.app, this).open();
                return true;
            },
        });

        this.addCommand({
            id: 'compress-current-image',
            name: t('command.compressImage'),
            checkCallback: (checking) => {
                const file = this.app.workspace.getActiveFile();
                if (!file || !this.isImageFile(file)) return false;
                if (!checking) void this.compressCurrentImage(file);
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
            id: 'upload-note-images',
            name: t('command.uploadNoteImages'),
            checkCallback: (checking) => {
                const file = this.app.workspace.getActiveFile();
                if (!file || file.extension !== 'md') return false;
                if (!checking) void this.uploadNoteImages(file);
                return true;
            },
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
                new Notice(t('notice.migrateNotImplemented'));
            },
        });

        this.addCommand({
            id: 'reorganize-images',
            name: t('command.reorganizeImages'),
            checkCallback: (checking) => {
                const file = this.app.workspace.getActiveFile();
                if (!file || file.extension !== 'md') return false;
                if (!checking) void this.reorganizeNote(file);
                return true;
            },
        });

        this.addCommand({
            id: 'convert-to-md',
            name: t('command.convertToMd'),
            checkCallback: (checking) => {
                const file = this.app.workspace.getActiveFile();
                if (!file || file.extension !== 'md') return false;
                if (!checking) void this.convertNoteToFormat(file, 'markdown');
                return true;
            },
        });

        // Settings tab
        this.addSettingTab(new ImageManagerSettingTab(this.app, this));

        // Intercept paste and drop for custom image reference format
        this.registerEvent(
            this.app.workspace.on('editor-paste', (evt, editor, info) => {
                if (evt.defaultPrevented) return;
                const handled = this.handleImagePaste(evt, editor, info.file);
                if (handled) evt.preventDefault();
            })
        );
        this.registerEvent(
            this.app.workspace.on('editor-drop', (evt, editor, info) => {
                if (evt.defaultPrevented) return;
                const handled = this.handleImageDrop(evt, editor, info.file);
                if (handled) evt.preventDefault();
            })
        );

        // Fix image references after Obsidian's built-in rename
        // Obsidian's link updater strips directory paths from markdown image refs
        this.registerEvent(
            this.app.vault.on('rename', (file, oldPath) => {
                this.invalidateRemoteReferenceIndex(file);
                if (file instanceof TFile) this.delegatedHandoff.onRename(file);
                if (!(file instanceof TFile) || !this.isImageFile(file)) return;
                this.indeterminateImages.touch(file, file.path);
                if (this.isReorganizing) return;
                this.renameRepairCoordinator.observe(file, oldPath, file.path);
            })
        );
        this.registerEvent(this.app.vault.on('create', (file) => {
            this.invalidateRemoteReferenceIndex(file);
            if (file instanceof TFile) this.delegatedHandoff.onCreate(file);
        }));
        this.registerEvent(this.app.vault.on('modify', (file) => {
            this.invalidateRemoteReferenceIndex(file);
            if (file instanceof TFile) this.delegatedHandoff.onModify(file);
        }));
        this.registerEvent(this.app.vault.on('delete', (file) => {
            this.invalidateRemoteReferenceIndex(file);
            if (file instanceof TFile) {
                this.delegatedHandoff.onDelete(file);
                this.renameRepairCoordinator.forget(file);
            }
        }));

        // Right-click menu: image management
        this.registerEvent(
            this.app.workspace.on('file-menu', (menu, file) => {
                if (file instanceof TFolder) {
                    menu.addSeparator();
                    menu.addItem((item) => {
                        item.setTitle(`Markdown Image Manager: ${t('command.reorganizeImages')}`)
                            .setIcon('image-file')
                            .onClick(() => this.reorganizeFolder(file.path));
                    });
                } else if (file instanceof TFile && file.extension === 'md') {
                    menu.addSeparator();
                    menu.addItem((item) => {
                        item.setTitle(`Markdown Image Manager: ${t('command.uploadNoteImages')}`)
                            .setIcon('upload')
                            .onClick(() => { void this.uploadNoteImages(file); });
                    });
                    menu.addItem((item) => {
                        item.setTitle(`Markdown Image Manager: ${t('command.reorganizeImages')}`)
                            .setIcon('image-file')
                            .onClick(() => this.reorganizeNote(file));
                    });
                    menu.addItem((item) => {
                        item.setTitle(`Markdown Image Manager: ${t('command.convertToMd')}`)
                            .setIcon('file-text')
                            .onClick(() => this.convertNoteToFormat(file, 'markdown'));
                    });
                }
            })
        );
    }

    onunload() {
        this.delegatedHandoff.cancelAll('unload');
        this.renameRepairCoordinator.cancel();
        this.indeterminateImages.clear();
    }

    private invalidateRemoteReferenceIndex(file: TAbstractFile) {
        if (file instanceof TFile && file.extension === 'md') {
            this.remoteReferenceIndex.invalidate();
        }
    }

    async loadSettings() {
        const loaded = await this.loadData() as Partial<ImageManagerSettings> | null;
        this.settings = normalizeImageManagerSettings(loaded);
        this.settings.remoteDeleteHistory = normalizeRemoteDeleteHistory(loaded?.remoteDeleteHistory);
    }

    async saveSettings() {
        await this.saveData(this.settings);
    }

    cancelDelegatedTransactions(): void {
        this.delegatedHandoff.cancelAll('cancelled');
    }

    getIndeterminateImagePaths(): Set<string> {
        return this.indeterminateImages.paths();
    }

    recordRemoteDeleteAudit(entry: RemoteDeleteAuditEntry): Promise<void> {
        return this.remoteDeleteAuditWriter.append(entry);
    }

    private isImageFile(file: TFile): boolean {
        const scanner = new ImageScanner(this.app, this.settings.supportedExtensions);
        return scanner.isImageFile(file);
    }

    private async compressCurrentImage(file: TFile) {
        if (this.confirmDelegatedLocalMutation('modal.delegatedRisk.compress', () => this.performCompressCurrentImage(file))) return;
        await this.performCompressCurrentImage(file);
    }

    private async performCompressCurrentImage(file: TFile) {
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

        // Always convert wiki → markdown
        const targetFormat = 'markdown';
        const refCount = counts.wiki;

        if (refCount === 0) {
            new Notice(t('notice.noRefsToConvert'));
            return;
        }

        const converted = this.refConverter.convertAllReferences(content, targetFormat, file);
        await this.app.vault.process(file, () => converted);
        new Notice(t('notice.convertSuccess', { count: String(refCount) }));
    }

    private async convertEntireVault() {
        const mdFiles = this.app.vault.getMarkdownFiles();
        const targetFormat = 'markdown';

        let totalConverted = 0;
        let filesChanged = 0;

        for (const file of mdFiles) {
            const content = await this.app.vault.cachedRead(file);
            const counts = this.refConverter.countReferences(content);
            const refCount = counts.wiki;

            if (refCount === 0) continue;

            const converted = this.refConverter.convertAllReferences(content, targetFormat, file);
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
                void this.doUpload(file, config);
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
            const result = await this.explicitUploads.uploadBatch(images, hostingConfig, (progress) => {
                new Notice(
                    t('notice.batchUploadProgress', {
                        done: String(progress.completed),
                        total: String(progress.total),
                        current: progress.current,
                    }),
                    2000
                );
            });
            new Notice(
                t('notice.batchUploadDone', {
                    success: String(result.successfulImages),
                    total: String(result.totalImages),
                })
            );
        };

        if (configs.length === 1) {
            await doBatch(configs[0]!);
        } else {
            new HostingSuggestModal(this.app, configs, (config) => {
                void doBatch(config);
            }).open();
        }
    }

    async doUpload(file: TFile, hostingConfig: ImageHostingConfig) {
        new Notice(t('notice.uploading'));

        try {
            const result = await this.explicitUploads.uploadImage(
                file,
                hostingConfig,
                this.settings.autoReplaceAfterUpload
            );

            if (result.operation.success && result.operation.url && result.reference) {
                new Notice(t('notice.uploadSuccessWithUrl', { url: result.operation.url }), 5000);
                await navigator.clipboard.writeText(result.reference);
                if (result.replacedReferences > 0) {
                    new Notice(t('notice.replaceSuccess', { count: String(result.replacedReferences) }));
                }
            } else {
                new Notice(t('notice.uploadFailed', { error: result.operation.error ?? t('notice.unknownError') }));
            }
        } catch (e) {
            new Notice(t('notice.uploadFailed', { error: e instanceof Error ? e.message : t('notice.unknownError') }));
        }
    }

    private async uploadNoteImages(file: TFile) {
        const configs = this.settings.hostingConfigs.filter((c) => c.enabled);
        if (configs.length === 0) {
            new Notice(t('notice.noHostingConfig'));
            return;
        }

        const chooseAndUpload = async (hostingConfig: ImageHostingConfig) => {
            const progress = new Notice(
                t('notice.batchUploadProgress', { done: '0', total: '0', current: '' }),
                0
            );
            try {
                const result = await this.explicitUploads.uploadNote(file, hostingConfig, (state) => {
                    progress.setMessage(t('notice.batchUploadProgress', {
                        done: String(state.completedImages),
                        total: String(state.totalImages),
                        current: state.current,
                    }));
                });
                if (result.totalReferences === 0) {
                    new Notice(t('notice.noteUploadNoImages'));
                    return;
                }
                if (result.failures.length > 0) {
                    const firstFailure = result.failures[0]!;
                    const error = firstFailure.kind === 'missing-file'
                        ? t('notice.noteUploadFileMissing')
                        : firstFailure.error ?? t('notice.unknownError');
                    new Notice(t('notice.noteUploadPartial', {
                        success: String(result.successfulReferences),
                        total: String(result.totalReferences),
                        failed: String(result.totalReferences - result.successfulReferences),
                        file: firstFailure.fileName,
                        error,
                    }), 10_000);
                } else {
                    new Notice(t('notice.noteUploadDone', {
                        success: String(result.successfulReferences),
                        total: String(result.totalReferences),
                    }));
                }
            } finally {
                progress.hide();
            }
        };

        if (configs.length === 1) {
            await chooseAndUpload(configs[0]!);
        } else {
            new HostingSuggestModal(this.app, configs, (config) => {
                chooseAndUpload(config).catch((e) => {
                    new Notice(t('notice.uploadFailed', {
                        error: e instanceof Error ? e.message : t('notice.unknownError'),
                    }));
                });
            }).open();
        }
    }

    private renameImage(file: TFile) {
        if (this.confirmDelegatedLocalMutation('modal.delegatedRisk.rename', () => this.openRenameImageModal(file))) return;
        this.openRenameImageModal(file);
    }

    private openRenameImageModal(file: TFile) {
        new RenameImageModal(this.app, file, (newName) => {
            void (async () => {
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
                    new Notice(t('notice.renameFailed', {
                        error: e instanceof Error ? e.message : t('notice.unknownError'),
                    }));
                }
            })();
        }).open();
    }

    private async reorganizeNote(file: TFile) {
        if (this.confirmDelegatedLocalMutation('modal.delegatedRisk.reorganize', () => this.performReorganizeNote(file))) return;
        await this.performReorganizeNote(file);
    }

    private async performReorganizeNote(file: TFile) {
        const reorganizer = new ImageReorganizer(this.app, this.settings, this.resolveImagePath.bind(this));
        this.isReorganizing = true;
        try {
            const result = await reorganizer.reorganizeNote(file, this.settings.reorganizeConvertFormat ? 'markdown' : undefined);
            new Notice(
                t('notice.reorganizeDone', {
                    note: '1',
                    moved: String(result.moved),
                    skipped: String(result.skipped),
                })
            );
        } catch (e) {
            new Notice(t('notice.reorganizeFailed', {
                error: e instanceof Error ? e.message : t('notice.unknownError'),
            }));
        } finally {
            this.isReorganizing = false;
        }
    }

    private async reorganizeFolder(folderPath: string) {
        if (this.confirmDelegatedLocalMutation('modal.delegatedRisk.reorganize', () => this.performReorganizeFolder(folderPath))) return;
        await this.performReorganizeFolder(folderPath);
    }

    private async performReorganizeFolder(folderPath: string) {
        const reorganizer = new ImageReorganizer(this.app, this.settings, this.resolveImagePath.bind(this));
        this.isReorganizing = true;
        try {
            const result = await reorganizer.reorganizeFolder(folderPath, this.settings.reorganizeConvertFormat ? 'markdown' : undefined);
            new Notice(
                t('notice.reorganizeDone', {
                    note: String(result.notes),
                    moved: String(result.moved),
                    skipped: String(result.skipped),
                })
            );
        } catch (e) {
            new Notice(t('notice.reorganizeFailed', {
                error: e instanceof Error ? e.message : t('notice.unknownError'),
            }));
        } finally {
            this.isReorganizing = false;
        }
    }

    private confirmDelegatedLocalMutation(
        messageKey: Parameters<typeof t>[0],
        onConfirm: () => void | Promise<void>
    ): boolean {
        if (this.settings.localManagementMode !== 'delegated') return false;
        new ConfirmDialog(this.app, {
            title: t('modal.delegatedRisk.title'),
            message: t(messageKey),
            confirmText: t('modal.delegatedRisk.confirm'),
            onConfirm,
        }).open();
        return true;
    }

    private async convertNoteToFormat(file: TFile, targetFormat: 'wiki' | 'markdown') {
        const content = await this.app.vault.cachedRead(file);
        const counts = this.refConverter.countReferences(content);
        const totalCount = counts.markdown + counts.wiki;

        if (totalCount === 0) {
            new Notice(t('notice.noRefsToConvert'));
            return;
        }

        const converted = this.refConverter.convertAllReferences(content, targetFormat, file);
        if (converted === content) {
            new Notice(t('notice.noRefsToConvert'));
            return;
        }

        await this.app.vault.process(file, () => converted);
        new Notice(t('notice.convertSuccess', { count: String(totalCount) }));
    }

    private handleImagePaste(evt: ClipboardEvent, editor: import('obsidian').Editor, file: TFile | null): boolean {
        const files = evt.clipboardData?.files;
        if (!files || files.length === 0) return false;

        const imageFiles = Array.from(files).filter((f) => f.type.startsWith('image/'));
        if (imageFiles.length === 0) return false;

        if (this.settings.localManagementMode === 'delegated') {
            this.delegatedHandoff.start(editor, file, imageFiles.length);
            return false;
        }

        this.managedPastePipeline.processFiles(imageFiles, editor, file);
        return true;
    }

    private handleImageDrop(evt: DragEvent, editor: import('obsidian').Editor, file: TFile | null): boolean {
        const files = evt.dataTransfer?.files;
        if (!files || files.length === 0) return false;

        const imageFiles = Array.from(files).filter((f) => f.type.startsWith('image/'));
        if (imageFiles.length === 0) return false;

        if (this.settings.localManagementMode === 'delegated') {
            this.delegatedHandoff.start(editor, file, imageFiles.length);
            return false;
        }

        this.managedPastePipeline.processFiles(imageFiles, editor, file);
        return true;
    }

    resolveImagePath(template: string, currentFile: TFile | null, filename: string): string {
        return this.managedPastePipeline.resolveImagePath(template, currentFile, filename);
    }

    private getDefaultHostingConfig(): ImageHostingConfig | null {
        const configs = this.settings.hostingConfigs.filter((c) => c.enabled);
        if (configs.length === 0) return null;
        if (this.settings.defaultHostingId) {
            const found = configs.find((c) => c.id === this.settings.defaultHostingId);
            if (found) return found;
        }
        return configs[0] ?? null;
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
