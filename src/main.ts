import { Notice, Plugin, TFile, TFolder, MarkdownView, SuggestModal, normalizePath } from 'obsidian';
import { ImageManagerSettings, DEFAULT_SETTINGS, ImageHostingConfig } from './types';
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
import { createUploader } from './uploaders/uploader-factory';
import { UploadQueue } from './uploaders/upload-queue';
import { setLocale, t } from './i18n';
import { getDateTemplateVars, getFileNameWithoutExt, encodePathSegments } from './utils/path-utils';
import { makePublicUrlReadable } from './utils/public-url';
import { generateImageFileName, sanitizeImageFileName } from './utils/image-naming';
import { removeEmptyDirectParent } from './utils/empty-folder-cleanup';
import { shouldReplaceLocalImageReference } from './utils/upload-reference';

export default class ImageManagerPlugin extends Plugin {
    settings: ImageManagerSettings;
    refConverter: RefConverter;
    imageOptimizer: ImageOptimizer;
    batchRename: BatchRename;
    private isReorganizing = false;
    async onload() {
        await this.loadSettings();
        setLocale(this.settings.locale);

        this.refConverter = new RefConverter(this.app);
        this.imageOptimizer = new ImageOptimizer(this.app);
        this.batchRename = new BatchRename(this.app, this.settings);

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
                if (!this.settings.reorganizeConvertFormat) return false;
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
                if (!(file instanceof TFile) || !this.isImageFile(file)) return;
                if (this.isReorganizing) return;
                window.setTimeout(() => {
                    void this.batchRename.fixBrokenImageRefs(oldPath, file.path);
                }, 100);
            })
        );

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
                    if (this.settings.reorganizeConvertFormat) {
                        menu.addItem((item) => {
                            item.setTitle(`Markdown Image Manager: ${t('command.uploadNoteImages')}`)
                                .setIcon('upload')
                                .onClick(() => this.uploadNoteImages(file));
                        });
                    }
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

    onunload() {}

    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData() as Partial<ImageManagerSettings>);
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
        if (!this.settings.reorganizeConvertFormat) {
            new Notice(t('settings.hostingDisabledByFormat'));
            return;
        }

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
        if (!this.settings.reorganizeConvertFormat) {
            new Notice(t('settings.hostingDisabledByFormat'));
            return;
        }

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
                void doBatch(config);
            }).open();
        }
    }

    async doUpload(file: TFile, hostingConfig: ImageHostingConfig) {
        new Notice(t('notice.uploading'));

        try {
            let data = await this.app.vault.readBinary(file);

            if (this.settings.autoCompress) {
                const result = await this.imageOptimizer.compressImage(file, this.settings.compressQuality);
                data = result.data;
            }

            const uploader = createUploader(hostingConfig, this.settings.uploadPathTemplate);
            const result = await uploader.upload(data, file.name, { sourcePath: file.path });

            if (result.success && result.url) {
                const ref = this.buildUploadedReference(file.name, result.url);
                new Notice(`${t('notice.uploadSuccess')}\n${result.url}`, 5000);
                await navigator.clipboard.writeText(ref);

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

    private async uploadNoteImages(file: TFile) {
        if (!this.settings.reorganizeConvertFormat) {
            new Notice(t('settings.hostingDisabledByFormat'));
            return;
        }

        const configs = this.settings.hostingConfigs.filter((c) => c.enabled);
        if (configs.length === 0) {
            new Notice(t('notice.noHostingConfig'));
            return;
        }

        const chooseAndUpload = async (hostingConfig: ImageHostingConfig) => {
            const content = await this.app.vault.cachedRead(file);
            const refs = this.refConverter.parseReferences(content);
            const noteDir = file.parent?.path ?? '';

            // Filter to local image references
            const localRefs = refs.filter((r) => !r.path.startsWith('http://') && !r.path.startsWith('https://'));
            if (localRefs.length === 0) {
                new Notice(t('notice.noteUploadNoImages'));
                return;
            }

            let success = 0;
            let newContent = content;
            const progress = new Notice(t('notice.batchUploadProgress', { done: '0', total: String(localRefs.length), current: '' }), 0);

            // Process from end to start to preserve positions
            for (let i = localRefs.length - 1; i >= 0; i--) {
                const ref = localRefs[i]!;
                const resolved = this.resolveRefPath(noteDir, ref.path);
                const imgFile = resolved ? this.app.vault.getAbstractFileByPath(resolved) : null;
                if (!(imgFile instanceof TFile)) continue;

                progress.setMessage(t('notice.batchUploadProgress', {
                    done: String(success),
                    total: String(localRefs.length),
                    current: imgFile.name,
                }));

                try {
                    let data = await this.app.vault.readBinary(imgFile);
                    if (this.settings.autoCompress) {
                        const result = await this.imageOptimizer.compressImage(imgFile, this.settings.compressQuality);
                        data = result.data;
                    }

                    const uploader = createUploader(hostingConfig, this.settings.uploadPathTemplate);
                    const result = await uploader.upload(data, imgFile.name, {
                        sourcePath: imgFile.path,
                    });

                    if (result.success && result.url) {
                        const newRef = this.buildUploadedReference(
                            imgFile.name,
                            result.url,
                            ref.altText || imgFile.name.replace(/\.[^.]+$/, '')
                        );
                        newContent = newContent.substring(0, ref.col) + newRef + newContent.substring(ref.col + ref.fullMatch.length);
                        success++;

                        // Update references in other notes (skip current file, handled by newContent)
                        await this.replaceReferenceInNote(imgFile, result.url, file);
                    } else {
                        console.error(`[ImageManager] Upload failed for ${imgFile.name}: ${result.error}`);
                    }
                } catch (e) {
                    console.error(`[ImageManager] Failed to upload ${imgFile.path}:`, e);
                }
            }

            progress.hide();
            if (success > 0) {
                await this.app.vault.process(file, () => newContent);
            }
            new Notice(t('notice.noteUploadDone', { success: String(success), total: String(localRefs.length) }));
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

    private resolveRefPath(noteDir: string, refPath: string): string | null {
        const decoded = refPath.replace(/%20/g, ' ');
        // Absolute vault path (starts with /)
        if (decoded.startsWith('/')) {
            return normalizePath(decoded.substring(1));
        }
        // Explicit relative path (starts with ../ or ./)
        if (decoded.startsWith('../') || decoded.startsWith('./')) {
            const baseParts = noteDir.split('/').filter(Boolean);
            const relParts = decoded.split('/').filter(Boolean);
            const parts = [...baseParts];
            for (const part of relParts) {
                if (part === '..') parts.pop();
                else if (part !== '.') parts.push(part);
            }
            return normalizePath(parts.join('/'));
        }
        // Path contains / — could be absolute vault path or relative path
        if (decoded.includes('/')) {
            // Try as absolute vault path first
            const absolutePath = normalizePath(decoded);
            if (this.app.vault.getAbstractFileByPath(absolutePath)) return absolutePath;
            // Try as relative path to noteDir
            const baseParts = noteDir.split('/').filter(Boolean);
            const relParts = decoded.split('/').filter(Boolean);
            const parts = [...baseParts];
            for (const part of relParts) {
                if (part === '..') parts.pop();
                else if (part !== '.') parts.push(part);
            }
            return normalizePath(parts.join('/'));
        }
        // Just a filename — try noteDir first, then vault root, then search entire vault
        const inNoteDir = normalizePath(`${noteDir}/${decoded}`);
        if (this.app.vault.getAbstractFileByPath(inNoteDir)) return inNoteDir;
        const inVaultRoot = normalizePath(decoded);
        if (this.app.vault.getAbstractFileByPath(inVaultRoot)) return inVaultRoot;
        const match = this.app.vault.getFiles().find((f) => f.name === decoded);
        return match?.path ?? null;
    }

    private buildUploadedReference(filename: string, url: string, altText?: string): string {
        const baseName = altText || filename.replace(/\.[^.]+$/, '');
        return `![${baseName}](${makePublicUrlReadable(url)})`;
    }

    private async replaceReferenceInNote(imageFile: TFile, newUrl: string, skipFile?: TFile) {
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
                        imageName,
                        newUrl,
                        ref.altText || imageName
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

        this.processImageFiles(imageFiles, editor, file);
        return true;
    }

    private handleImageDrop(evt: DragEvent, editor: import('obsidian').Editor, file: TFile | null): boolean {
        const files = evt.dataTransfer?.files;
        if (!files || files.length === 0) return false;

        const imageFiles = Array.from(files).filter((f) => f.type.startsWith('image/'));
        if (imageFiles.length === 0) return false;

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
        if (this.settings.autoCompress && ext !== 'svg') {
            try {
                const blob = new Blob([data], { type: mimeType });
                const img = await this.blobToImage(blob);
                const canvas = activeDocument.createElement('canvas');
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
        if (this.settings.reorganizeConvertFormat) {
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
        if (this.settings.autoUploadOnPaste && this.settings.reorganizeConvertFormat) {
            this.autoUploadAfterPaste(savedFile, outputData, editor, currentFile).catch(() => {});
        }
    }

    private async autoUploadAfterPaste(savedFile: TFile, data: ArrayBuffer, editor: import('obsidian').Editor, currentFile: TFile | null) {
        const hostingConfig = this.getDefaultHostingConfig();
        if (!hostingConfig) return;
        const attachmentFolder = savedFile.parent;

        const notice = new Notice(t('notice.autoUploading'), 0);

        try {
            const uploader = createUploader(hostingConfig, this.settings.uploadPathTemplate);
            const result = await uploader.upload(data, savedFile.name, {
                sourcePath: savedFile.path,
            });

            if (result.success && result.url) {
                const ref = this.buildUploadedReference(savedFile.name, result.url);

                // Replace the local reference we just inserted with the remote URL
                const cursor = editor.getCursor();
                const line = editor.getLine(cursor.line);
                const localRefMatch = line.match(/!\[.*?\]\(.*?\)|!\[\[.*?\]\]/);
                if (localRefMatch) {
                    const start = localRefMatch.index!;
                    const end = start + localRefMatch[0].length;
                    editor.replaceRange(ref, { line: cursor.line, ch: start }, { line: cursor.line, ch: end });
                }

                // Replace references in other notes
                await this.replaceReferenceInNote(savedFile, result.url, currentFile ?? undefined);

                // Delete local file if user doesn't want to keep it
                if (!this.settings.keepLocalCopy) {
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
