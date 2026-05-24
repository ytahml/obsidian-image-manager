import { Notice, Plugin, TFile, TFolder, MarkdownView, SuggestModal } from 'obsidian';
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
import { getDateTemplateVars, getFileNameWithoutExt } from './utils/path-utils';

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

        this.addCommand({
            id: 'reorganize-images',
            name: t('command.reorganizeImages'),
            checkCallback: (checking) => {
                const file = this.app.workspace.getActiveFile();
                if (!file || file.extension !== 'md') return false;
                if (!checking) this.reorganizeNote(file);
                return true;
            },
        });

        // Settings tab
        this.addSettingTab(new ImageManagerSettingTab(this.app, this));

        // Intercept paste and drop for custom image reference format
        this.registerEvent(
            this.app.workspace.on('editor-paste', (evt, editor, info) => {
                this.handleImagePaste(evt, editor, info.file);
            })
        );
        this.registerEvent(
            this.app.workspace.on('editor-drop', (evt, editor, info) => {
                this.handleImageDrop(evt, editor, info.file);
            })
        );

        // Right-click menu: reorganize images
        this.registerEvent(
            this.app.workspace.on('file-menu', (menu, file) => {
                if (file instanceof TFolder) {
                    menu.addItem((item) => {
                        item.setTitle(t('command.reorganizeImages'))
                            .setIcon('folder-input')
                            .onClick(() => this.reorganizeFolder(file.path));
                    });
                } else if (file instanceof TFile && file.extension === 'md') {
                    menu.addItem((item) => {
                        item.setTitle(t('command.reorganizeImages'))
                            .setIcon('image-file')
                            .onClick(() => this.reorganizeNote(file));
                    });
                }
            })
        );
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

        // Detect format from note content, convert to the opposite
        const sourceFormat = counts.markdown >= counts.wiki ? 'markdown' : 'wiki';
        const targetFormat = sourceFormat === 'wiki' ? 'markdown' : 'wiki';
        const refCount = sourceFormat === 'wiki' ? counts.wiki : counts.markdown;

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

    private async reorganizeNote(file: TFile) {
        const reorganizer = new ImageReorganizer(this.app, this.settings, this.resolveImagePath.bind(this));
        try {
            const result = await reorganizer.reorganizeNote(file);
            new Notice(
                t('notice.reorganizeDone', {
                    note: '1',
                    moved: String(result.moved),
                    skipped: String(result.skipped),
                })
            );
        } catch (e) {
            new Notice(t('notice.reorganizeFailed', { error: e instanceof Error ? e.message : 'Unknown error' }));
        }
    }

    private async reorganizeFolder(folderPath: string) {
        const reorganizer = new ImageReorganizer(this.app, this.settings, this.resolveImagePath.bind(this));
        try {
            const result = await reorganizer.reorganizeFolder(folderPath);
            new Notice(
                t('notice.reorganizeDone', {
                    note: String(result.notes),
                    moved: String(result.moved),
                    skipped: String(result.skipped),
                })
            );
        } catch (e) {
            new Notice(t('notice.reorganizeFailed', { error: e instanceof Error ? e.message : 'Unknown error' }));
        }
    }

    private handleImagePaste(evt: ClipboardEvent, editor: import('obsidian').Editor, file: TFile | null) {
        if (evt.defaultPrevented) return;
        const files = evt.clipboardData?.files;
        if (!files || files.length === 0) return;

        const imageFiles = Array.from(files).filter((f) => f.type.startsWith('image/'));
        if (imageFiles.length === 0) return;

        evt.preventDefault();

        this.processImageFiles(imageFiles, editor, file);
    }

    private handleImageDrop(evt: DragEvent, editor: import('obsidian').Editor, file: TFile | null) {
        if (evt.defaultPrevented) return;
        const files = evt.dataTransfer?.files;
        if (!files || files.length === 0) return;

        const imageFiles = Array.from(files).filter((f) => f.type.startsWith('image/'));
        if (imageFiles.length === 0) return;

        evt.preventDefault();

        this.processImageFiles(imageFiles, editor, file);
    }

    private processImageFiles(files: File[], editor: import('obsidian').Editor, currentFile: TFile | null) {
        for (const imgFile of files) {
            const ext = this.mimeToExt(imgFile.type);
            const defaultName = this.generateFileName(ext);

            if (this.settings.promptImageName) {
                new ImageNamePromptModal(this.app, defaultName, (userNamed) => {
                    const safeName = this.sanitizeFileName(userNamed, ext);
                    imgFile.arrayBuffer().then((buffer) => {
                        this.savePastedImage(new Uint8Array(buffer), imgFile.type, safeName, editor, currentFile);
                    });
                }).open();
            } else {
                imgFile.arrayBuffer().then((buffer) => {
                    this.savePastedImage(new Uint8Array(buffer), imgFile.type, defaultName, editor, currentFile);
                });
            }
        }
    }

    private generateFileName(ext: string): string {
        const now = new Date();
        const vars: Record<string, string> = {
            date: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`,
            time: `${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}`,
            timestamp: String(now.getTime()),
            random: Math.random().toString(36).substring(2, 6),
            year: String(now.getFullYear()),
            month: String(now.getMonth() + 1).padStart(2, '0'),
            day: String(now.getDate()).padStart(2, '0'),
            counter: String(this.pasteCounter++),
        };

        let template = this.settings.imageNamingTemplate || 'image-{date}-{random}';
        for (const [key, value] of Object.entries(vars)) {
            template = template.replace(new RegExp(`\\{${key}\\}`, 'g'), value);
        }

        return this.sanitizeFileName(template, ext);
    }

    private sanitizeFileName(name: string, ext: string): string {
        // Remove extension if user included it
        const extPattern = new RegExp(`\\.${ext}$`, 'i');
        let base = name.replace(extPattern, '');

        // Replace spaces and unsafe characters with hyphens
        base = base
            .replace(/\s+/g, '-')
            .replace(/[/\\:*?"<>|]/g, '')
            .replace(/-{2,}/g, '-')
            .replace(/^-+|-+$/g, '');

        if (!base) base = 'image';

        return `${base}.${ext}`;
    }

    private async ensureUniquePath(dir: string, filename: string): Promise<string> {
        const ext = filename.split('.').pop() ?? '';
        const baseName = filename.replace(new RegExp(`\\.${ext}$`), '');
        let filePath = dir === '.' ? filename : `${dir}/${filename}`;
        let counter = 1;

        while (this.app.vault.getAbstractFileByPath(filePath)) {
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
                const canvas = document.createElement('canvas');
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
        const savedFile = await this.app.vault.createBinary(filePath, outputData);

        // Insert reference (URL-encode path for markdown format to handle spaces)
        const format = this.settings.referenceFormat;
        let ref: string;
        if (format === 'wiki') {
            ref = `![[${savedFile.name}]]`;
        } else {
            const encodedPath = savedFile.path.split('/').map(encodeURIComponent).join('/');
            ref = `![${savedFile.name}](${encodedPath})`;
        }
        editor.replaceSelection(ref);
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
