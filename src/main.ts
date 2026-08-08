import { Notice, Plugin, TAbstractFile, TFile, TFolder, MarkdownView, SuggestModal } from 'obsidian';
import { ImageManagerSettings, ImageHostingConfig, normalizeImageManagerSettings } from './types';
import { ImageManagerSettingTab } from './settings';
import { ImageBrowserModal } from './modals/image-browser';
import { OrphanImagesModal } from './modals/orphan-images';
import { RenameImageModal } from './modals/rename-image';
import { ImageNamePromptModal } from './modals/image-name-prompt';
import { RefConverter } from './utils/ref-converter';
import { ImageOptimizer } from './utils/image-optimizer';
import { ImageScanner } from './utils/image-scanner';
import { BatchRename } from './utils/batch-rename';
import { ImageReorganizer } from './utils/image-reorganizer';
import { UploadQueue } from './uploaders/upload-queue';
import { UploadService } from './uploaders/upload-service';
import { summarizeUploadError } from './uploaders/upload-error';
import { collectLocalNoteImages } from './uploaders/note-images';
import { setLocale, t } from './i18n';
import { getDateTemplateVars, getFileNameWithoutExt, encodePathSegments } from './utils/path-utils';
import { makePublicUrlReadable } from './utils/public-url';
import { generateImageFileName, sanitizeImageFileName } from './utils/image-naming';
import {
    renderCustomReference,
    resolveReferenceTemplateFileVars,
    type ReferenceTemplateFileVars,
} from './utils/reference-template';
import { removeEmptyDirectParent } from './utils/empty-folder-cleanup';
import { shouldReplaceLocalImageReference } from './utils/upload-reference';
import { RemoteReferenceIndex } from './remote/reference-index';
import type { RemoteDeleteAuditEntry } from './remote/types';
import { normalizeRemoteDeleteHistory, RemoteDeleteAuditWriter } from './remote/delete-audit';
import { ObsidianDelegatedHandoff } from './lifecycle/obsidian-delegated-handoff';
import { chooseManagedPasteUploadSource } from './lifecycle/managed-paste-upload-policy';
import { ExternalRenameRepairCoordinator } from './lifecycle/external-rename-repair-coordinator';
import { IndeterminateImageRegistry } from './lifecycle/indeterminate-image-registry';
import { scanLocalOrphans } from './utils/local-orphan-management';
import { ConfirmDialog } from './modals/confirm-dialog';
import { findExactManagedPasteReference } from './lifecycle/managed-paste-reference';

export default class ImageManagerPlugin extends Plugin {
    settings: ImageManagerSettings;
    refConverter: RefConverter;
    imageOptimizer: ImageOptimizer;
    batchRename: BatchRename;
    remoteReferenceIndex: RemoteReferenceIndex;
    uploadService: UploadService;
    private delegatedHandoff: ObsidianDelegatedHandoff;
    private isReorganizing = false;
    private renameRepairCoordinator: ExternalRenameRepairCoordinator<TFile>;
    private indeterminateImages: IndeterminateImageRegistry<TFile>;
    private remoteDeleteAuditWriter: RemoteDeleteAuditWriter;
    async onload() {
        await this.loadSettings();
        setLocale(this.settings.locale);

        this.refConverter = new RefConverter(this.app);
        this.imageOptimizer = new ImageOptimizer(this.app);
        this.uploadService = new UploadService(this.app, this.settings);
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
            buildUploadedReference: (url, vars, alt, template) => this.buildUploadedReference(url, vars, alt, template),
            getReferenceTemplateFileVars: (file, template) => this.getReferenceTemplateFileVars(file, template),
            getDefaultHostingConfig: () => this.getDefaultHostingConfig(),
            notice: (message, timeout) => new Notice(message, timeout),
            beginIndeterminate: (file) => this.indeterminateImages.begin(file, file.path),
            touchIndeterminate: (file) => this.indeterminateImages.touch(file, file.path),
            endIndeterminate: (file) => this.indeterminateImages.end(file, file.path),
            isIndeterminate: (file) => this.indeterminateImages.paths().has(file.path),
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
                new Notice(`${t('command.migrateImages')} - ${t('notice.notImplemented')}`);
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

            const queue = new UploadQueue(this.uploadService);
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
                void doBatch(config);
            }).open();
        }
    }

    async doUpload(file: TFile, hostingConfig: ImageHostingConfig) {
        new Notice(t('notice.uploading'));

        try {
            const result = await this.uploadService.uploadFile(file, hostingConfig);

            if (result.success && result.url) {
                const templateVars = await this.getReferenceTemplateFileVars(file);
                const ref = this.buildUploadedReference(result.url, templateVars);
                new Notice(`${t('notice.uploadSuccess')}\n${result.url}`, 5000);
                await navigator.clipboard.writeText(ref);

                if (this.settings.autoReplaceAfterUpload) {
                    await this.replaceReferenceInNote(file, result.url, undefined, templateVars);
                }
            } else {
                new Notice(t('notice.uploadFailed', { error: result.error ?? 'Unknown error' }));
            }
        } catch (e) {
            new Notice(t('notice.uploadFailed', { error: e instanceof Error ? e.message : 'Unknown error' }));
        }
    }

    private async uploadNoteImages(file: TFile) {
        const configs = this.settings.hostingConfigs.filter((c) => c.enabled);
        if (configs.length === 0) {
            new Notice(t('notice.noHostingConfig'));
            return;
        }

        const chooseAndUpload = async (hostingConfig: ImageHostingConfig) => {
            const { content, references: localRefs } = await collectLocalNoteImages(
                this.app,
                file,
                this.refConverter
            );
            if (localRefs.length === 0) {
                new Notice(t('notice.noteUploadNoImages'));
                return;
            }

            let success = 0;
            let newContent = content;
            const failures: Array<{ fileName: string; error: string }> = [];
            const progress = new Notice(t('notice.batchUploadProgress', { done: '0', total: String(localRefs.length), current: '' }), 0);

            // Process from end to start to preserve positions
            for (let i = localRefs.length - 1; i >= 0; i--) {
                const { reference: ref, file: imgFile } = localRefs[i]!;
                if (!imgFile) {
                    failures.push({ fileName: ref.path, error: t('notice.noteUploadFileMissing') });
                    continue;
                }

                progress.setMessage(t('notice.batchUploadProgress', {
                    done: String(success),
                    total: String(localRefs.length),
                    current: imgFile.name,
                }));

                try {
                    const result = await this.uploadService.uploadFile(imgFile, hostingConfig);

                    if (result.success && result.url) {
                        const templateVars = await this.getReferenceTemplateFileVars(imgFile);
                        const newRef = this.buildUploadedReference(
                            result.url,
                            templateVars,
                            ref.altText || imgFile.name.replace(/\.[^.]+$/, '')
                        );
                        newContent = newContent.substring(0, ref.col) + newRef + newContent.substring(ref.col + ref.fullMatch.length);
                        success++;

                        // Update references in other notes (skip current file, handled by newContent)
                        await this.replaceReferenceInNote(imgFile, result.url, file, templateVars);
                    } else {
                        failures.push({
                            fileName: imgFile.name,
                            error: summarizeUploadError(result.error),
                        });
                        console.error(`[ImageManager] Upload failed for ${imgFile.name}: ${result.error}`);
                    }
                } catch (e) {
                    failures.push({
                        fileName: imgFile.name,
                        error: summarizeUploadError(e instanceof Error ? e.message : undefined),
                    });
                    console.error(`[ImageManager] Failed to upload ${imgFile.path}:`, e);
                }
            }

            progress.hide();
            if (success > 0) {
                await this.app.vault.process(file, () => newContent);
            }
            if (failures.length > 0) {
                const firstFailure = failures[0]!;
                new Notice(t('notice.noteUploadPartial', {
                    success: String(success),
                    total: String(localRefs.length),
                    failed: String(failures.length),
                    file: firstFailure.fileName,
                    error: firstFailure.error,
                }), 10_000);
            } else {
                new Notice(t('notice.noteUploadDone', { success: String(success), total: String(localRefs.length) }));
            }
        };

        if (configs.length === 1) {
            await chooseAndUpload(configs[0]!);
        } else {
            new HostingSuggestModal(this.app, configs, (config) => {
                chooseAndUpload(config).catch((e) => {
                    new Notice(t('notice.uploadFailed', { error: e instanceof Error ? e.message : 'Unknown' }));
                });
            }).open();
        }
    }

    private buildUploadedReference(
        url: string,
        fileVars: ReferenceTemplateFileVars,
        altText?: string,
        template: string = this.settings.customReferenceTemplate
    ): string {
        const baseName = altText || fileVars.fileBaseName;
        const readableUrl = makePublicUrlReadable(url);
        const customReference = renderCustomReference(template, {
            fileUrl: readableUrl,
            fileAlt: baseName,
            ...fileVars,
        });
        if (customReference !== null) return customReference;

        return `![${baseName}](${readableUrl})`;
    }

    private async getReferenceTemplateFileVars(
        file: TFile,
        template: string = this.settings.customReferenceTemplate
    ): Promise<ReferenceTemplateFileVars> {
        return resolveReferenceTemplateFileVars(
            template,
            file,
            () => this.imageOptimizer.getImageInfo(file),
            (error) => {
                console.warn(
                    `[ImageManager] Failed to read image dimensions for ${file.path}:`,
                    error
                );
            }
        );
    }

    private async replaceReferenceInNote(
        imageFile: TFile,
        newUrl: string,
        skipFile: TFile | undefined,
        fileVars: ReferenceTemplateFileVars
    ) {
        const mdFiles = this.app.vault.getMarkdownFiles();
        let totalReplaced = 0;

        for (const mdFile of mdFiles) {
            if (skipFile && mdFile.path === skipFile.path) continue;
            const content = await this.app.vault.cachedRead(mdFile);
            const refs = this.refConverter.parseReferences(content);

            const imageName = imageFile.name;
            const imagePath = imageFile.path;
            let newContent = content;
            let replaced = false;

            for (let i = refs.length - 1; i >= 0; i--) {
                const ref = refs[i]!;
                if (shouldReplaceLocalImageReference(ref.path, imageName, imagePath)) {
                    const newRef = this.buildUploadedReference(
                        newUrl,
                        fileVars,
                        ref.altText || fileVars.fileBaseName
                    );
                    newContent = newContent.substring(0, ref.col) + newRef + newContent.substring(ref.col + ref.fullMatch.length);
                    replaced = true;
                    totalReplaced++;
                }
            }

            if (replaced) {
                await this.app.vault.process(mdFile, () => newContent);
            }
        }

        if (totalReplaced > 0) {
            new Notice(t('notice.replaceSuccess', { count: String(totalReplaced) }));
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
                    new Notice(t('notice.renameFailed', { error: e instanceof Error ? e.message : 'Unknown error' }));
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
            new Notice(t('notice.reorganizeFailed', { error: e instanceof Error ? e.message : 'Unknown error' }));
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
            new Notice(t('notice.reorganizeFailed', { error: e instanceof Error ? e.message : 'Unknown error' }));
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

        this.processImageFiles(imageFiles, editor, file);
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

        this.processImageFiles(imageFiles, editor, file);
        return true;
    }

    private processImageFiles(files: File[], editor: import('obsidian').Editor, currentFile: TFile | null) {
        for (const imgFile of files) {
            const ext = this.mimeToExt(imgFile.type);
            const defaultName = this.generateFileName(ext, currentFile);

            if (this.settings.promptImageName) {
                new ImageNamePromptModal(this.app, defaultName, (userNamed) => {
                    const safeName = sanitizeImageFileName(userNamed, ext);
                    void imgFile.arrayBuffer().then((buffer) => {
                        void this.savePastedImage(new Uint8Array(buffer), imgFile.type, safeName, editor, currentFile);
                    }).catch((e) => {
                        new Notice(`Image save failed: ${e instanceof Error ? e.message : 'Unknown error'}`);
                    });
                }).open();
            } else {
                void imgFile.arrayBuffer().then((buffer) => {
                    void this.savePastedImage(new Uint8Array(buffer), imgFile.type, defaultName, editor, currentFile);
                }).catch((e) => {
                    new Notice(`Image save failed: ${e instanceof Error ? e.message : 'Unknown error'}`);
                });
            }
        }
    }

    private generateFileName(ext: string, currentFile: TFile | null): string {
        const noteName = currentFile ? getFileNameWithoutExt(currentFile.path) : '';
        return generateImageFileName(
            this.settings.imageNamingTemplate,
            ext,
            noteName,
            new Date(),
            this.pasteCounter++
        );
    }

    private async ensureUniquePath(dir: string, filename: string): Promise<string> {
        const ext = filename.split('.').pop() ?? '';
        const baseName = filename.replace(new RegExp(`\\.${ext}$`), '');
        let filePath = dir === '.' ? filename : `${dir}/${filename}`;
        let counter = 1;

        while (
            this.app.vault.getAbstractFileByPath(filePath) ||
            (await this.app.vault.adapter.exists(filePath))
        ) {
            const newName = `${baseName}-${counter}.${ext}`;
            filePath = dir === '.' ? newName : `${dir}/${newName}`;
            counter++;
        }

        return filePath;
    }

    resolveImagePath(template: string, currentFile: TFile | null, filename: string): string {
        const noteName = currentFile ? getFileNameWithoutExt(currentFile.path) : '';
        const notePath = currentFile ? (currentFile.parent?.path ?? '') : '';
        const dateVars = getDateTemplateVars();

        const vars: Record<string, string> = {
            noteName,
            notePath,
            filename,
            ...dateVars,
        };

        let result = template;
        for (const [key, value] of Object.entries(vars)) {
            result = result.replace(new RegExp(`\\{${key}\\}`, 'g'), value);
        }

        // Clean up empty segments and leading/trailing slashes
        result = result
            .replace(/\/+/g, '/')
            .replace(/^\/|\/$/g, '')
            .replace(/\/\//g, '/');

        // Remove trailing slash that could result from empty {noteName}
        if (result.endsWith('/')) result = result.slice(0, -1);

        const resolved = result || 'attachments';

        // If base is 'note', prepend the note's parent directory
        if (this.settings.imagePathBase === 'note' && notePath) {
            return `${notePath}/${resolved}`;
        }

        return resolved;
    }

    private async savePastedImage(
        data: Uint8Array,
        mimeType: string,
        filename: string,
        editor: import('obsidian').Editor,
        currentFile: TFile | null
    ) {
        const ext = this.mimeToExt(mimeType);
        const dir = this.resolveImagePath(this.settings.imagePathTemplate || 'attachments', currentFile, filename);

        // Ensure directory exists (create intermediate folders)
        if (dir) {
            const parts = dir.split('/');
            let current = '';
            for (const part of parts) {
                current = current ? `${current}/${part}` : part;
                if (!this.app.vault.getAbstractFileByPath(current)) {
                    await this.app.vault.createFolder(current).catch(() => {});
                }
            }
        }

        // Handle filename collision
        const filePath = await this.ensureUniquePath(dir, filename);

        // Compress if enabled
        let outputData: ArrayBuffer = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
        let localDataCompressed = false;
        if (this.settings.compressManagedPasteLocal && ext !== 'svg') {
            try {
                const blob = new Blob([data], { type: mimeType });
                const img = await this.blobToImage(blob);
                const canvas = createEl('canvas');
                canvas.width = img.naturalWidth;
                canvas.height = img.naturalHeight;
                const ctx = canvas.getContext('2d')!;
                ctx.drawImage(img, 0, 0);

                const quality = this.settings.compressQuality / 100;
                const outputMime = ext === 'png' ? 'image/webp' : mimeType;
                const compressedBlob = await new Promise<Blob>((resolve, reject) => {
                    canvas.toBlob(
                        (b) => (b ? resolve(b) : reject(new Error('Canvas toBlob failed'))),
                        outputMime,
                        quality
                    );
                });
                outputData = await compressedBlob.arrayBuffer();
                localDataCompressed = true;
                URL.revokeObjectURL(img.src);
            } catch {
                outputData = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
            }
        }

        // Save to vault
        let savedFile: TFile;
        try {
            console.debug(`[ImageManager] Saving image to: ${filePath}`);
            savedFile = await this.app.vault.createBinary(filePath, outputData);
        } catch {
            // Race condition: ensureUniquePath checked in-memory map but createBinary
            // checks filesystem. Retry with a guaranteed-unique timestamp name.
            console.warn(`[ImageManager] File conflict at ${filePath}, retrying with unique name`);
            const ts = Date.now();
            const retryName = `${filename.replace(/\.[^.]+$/, '')}-${ts}.${ext}`;
            const retryPath = await this.ensureUniquePath(dir, retryName);
            console.debug(`[ImageManager] Retrying with: ${retryPath}`);
            savedFile = await this.app.vault.createBinary(retryPath, outputData);
        }

        // Insert reference based on format setting
        const noteDir = currentFile?.parent?.path ?? '';
        let ref: string;
        if (this.settings.managedPasteReferenceFormat === 'markdown') {
            // Markdown standard format: ![alt](path)
            const relativePath = noteDir ? this.computeRelativePath(noteDir, savedFile.path) : savedFile.path;
            const encodedPath = encodePathSegments(relativePath);
            ref = `![${savedFile.name}](${encodedPath})`;
        } else {
            // Wiki format: ![[filename]]
            ref = `![[${savedFile.name}]]`;
        }
        editor.replaceSelection(ref);

        // Auto-upload to hosting if enabled (requires Markdown format)
        if (this.settings.autoUploadOnPaste) {
            this.autoUploadAfterPaste(savedFile, ref, outputData, localDataCompressed, editor, currentFile).catch(() => {});
        }
    }

    private async autoUploadAfterPaste(
        savedFile: TFile,
        localReference: string,
        data: ArrayBuffer,
        localDataCompressed: boolean,
        editor: import('obsidian').Editor,
        currentFile: TFile | null
    ) {
        const hostingConfig = this.getDefaultHostingConfig();
        if (!hostingConfig) return;
        const attachmentFolder = savedFile.parent;

        const notice = new Notice(t('notice.autoUploading'), 0);

        try {
            const uploadSource = chooseManagedPasteUploadSource({
                localCompressed: localDataCompressed,
                uploadCompression: this.settings.compressBeforeUpload,
            });
            const result = uploadSource === 'saved-file'
                ? await this.uploadService.uploadFile(savedFile, hostingConfig)
                : await this.uploadService.uploadData(data, savedFile.name, hostingConfig, {
                    sourcePath: savedFile.path,
                });

            if (result.success && result.url) {
                const templateVars = await this.getReferenceTemplateFileVars(savedFile);
                const replaced = this.replaceManagedPasteReference(
                    editor,
                    currentFile,
                    savedFile,
                    localReference,
                    result.url,
                    templateVars
                );
                if (!replaced) throw new Error(t('notice.delegatedReferenceChanged'));

                // Replace references in other notes
                await this.replaceReferenceInNote(
                    savedFile,
                    result.url,
                    currentFile ?? undefined,
                    templateVars
                );

                // Delete local file if user doesn't want to keep it
                if (!this.settings.keepLocalCopy) {
                    const overrides = currentFile
                        ? new Map([[currentFile.path, editor.getValue()]])
                        : new Map<string, string>();
                    const localState = await scanLocalOrphans(
                        this.app,
                        this.settings.supportedExtensions,
                        overrides,
                        this.getIndeterminateImagePaths()
                    );
                    if (!localState.orphans.some((file) => file === savedFile)) {
                        notice.hide();
                        new Notice(t('notice.autoUploadSuccess'), 3000);
                        return;
                    }
                    await this.app.fileManager.trashFile(savedFile);
                    await removeEmptyDirectParent(this.app.vault, attachmentFolder);
                }

                notice.hide();
                new Notice(t('notice.autoUploadSuccess'), 3000);
            } else {
                notice.hide();
                new Notice(t('notice.autoUploadFailed', { error: result.error ?? 'Unknown' }), 5000);
            }
        } catch (e) {
            notice.hide();
            new Notice(t('notice.autoUploadFailed', { error: e instanceof Error ? e.message : 'Unknown' }), 5000);
        }
    }

    private replaceManagedPasteReference(
        editor: import('obsidian').Editor,
        currentFile: TFile | null,
        savedFile: TFile,
        localReference: string,
        url: string,
        templateVars: ReferenceTemplateFileVars
    ): boolean {
        if (!currentFile) return false;
        const content = editor.getValue();
        const match = findExactManagedPasteReference(
            this.refConverter.parseReferences(content),
            localReference,
            (reference) => this.app.metadataCache.getFirstLinkpathDest(reference.path, currentFile.path) === savedFile
        );
        if (!match) return false;
        const replacement = this.buildUploadedReference(url, templateVars, match.altText || templateVars.fileBaseName);
        const start = this.offsetToEditorPosition(content, match.col);
        const end = this.offsetToEditorPosition(content, match.col + match.fullMatch.length);
        editor.replaceRange(replacement, start, end);
        return true;
    }

    private offsetToEditorPosition(content: string, offset: number): { line: number; ch: number } {
        const lines = content.substring(0, offset).split('\n');
        return { line: lines.length - 1, ch: lines[lines.length - 1]!.length };
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

    private pasteCounter = 0;

    private blobToImage(blob: Blob): Promise<HTMLImageElement> {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => resolve(img);
            img.onerror = () => reject(new Error('Failed to load image'));
            img.src = URL.createObjectURL(blob);
        });
    }

    private mimeToExt(mimeType: string): string {
        const map: Record<string, string> = {
            'image/png': 'png',
            'image/jpeg': 'jpg',
            'image/gif': 'gif',
            'image/webp': 'webp',
            'image/bmp': 'bmp',
            'image/svg+xml': 'svg',
            'image/tiff': 'tiff',
            'image/avif': 'avif',
        };
        return map[mimeType] ?? 'png';
    }

    private computeRelativePath(fromDir: string, toPath: string): string {
        const fromParts = fromDir.split('/').filter(Boolean);
        const toParts = toPath.split('/').filter(Boolean);
        let commonLen = 0;
        while (commonLen < fromParts.length && commonLen < toParts.length && fromParts[commonLen] === toParts[commonLen]) {
            commonLen++;
        }
        const upCount = fromParts.length - commonLen;
        const ups: string[] = Array.from({ length: upCount }, () => '..');
        const downs = toParts.slice(commonLen);
        const result = [...ups, ...downs].join('/');
        return result || toPath;
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
