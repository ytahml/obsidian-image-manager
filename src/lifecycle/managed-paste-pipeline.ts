import { Notice, type App, type Editor, TFile } from 'obsidian';
import type { ImageHostingConfig, ImageManagerSettings } from '../types';
import type { RefConverter } from '../utils/ref-converter';
import type { UploadService } from '../uploaders/upload-service';
import type {
    PreparedUploadReference,
    UploadReferenceManager,
} from '../uploaders/upload-reference-manager';
import { ImageNamePromptModal } from '../modals/image-name-prompt';
import { generateImageFileName, sanitizeImageFileName } from '../utils/image-naming';
import {
    decodePathSegments,
    encodePathSegments,
    getDateTemplateVars,
    getFileNameWithoutExt,
} from '../utils/path-utils';
import { chooseManagedPasteUploadSource } from './managed-paste-upload-policy';
import { findExactManagedPasteReference } from './managed-paste-reference';
import { scanLocalOrphans } from '../utils/local-orphan-management';
import { removeEmptyDirectParent } from '../utils/empty-folder-cleanup';
import { t } from '../i18n';

export interface ManagedPastePipelineOptions {
    app: App;
    getSettings: () => ImageManagerSettings;
    uploadService: UploadService;
    refConverter: RefConverter;
    uploadReferences: Pick<UploadReferenceManager, 'prepare' | 'replaceVaultReferences'>;
    getDefaultHostingConfig: () => ImageHostingConfig | null;
    getIndeterminateImagePaths: () => Set<string>;
}

/** Owns the local save and optional upload transaction for managed paste/drop. */
export class ManagedPastePipeline {
    private pasteCounter = 0;

    constructor(private readonly options: ManagedPastePipelineOptions) {}

    processFiles(files: File[], editor: Editor, currentFile: TFile | null): void {
        for (const imageFile of files) {
            const extension = this.mimeToExtension(imageFile.type);
            const defaultName = this.generateFileName(extension, currentFile);

            if (this.settings.promptImageName) {
                new ImageNamePromptModal(this.options.app, defaultName, (userNamed) => {
                    const safeName = sanitizeImageFileName(userNamed, extension);
                    this.readAndSave(imageFile, safeName, editor, currentFile);
                }).open();
            } else {
                this.readAndSave(imageFile, defaultName, editor, currentFile);
            }
        }
    }

    resolveImagePath(template: string, currentFile: TFile | null, filename: string): string {
        const noteName = currentFile ? getFileNameWithoutExt(currentFile.path) : '';
        const notePath = currentFile ? (currentFile.parent?.path ?? '') : '';
        const vars: Record<string, string> = {
            noteName,
            notePath,
            filename,
            ...getDateTemplateVars(),
        };

        let result = template;
        for (const [key, value] of Object.entries(vars)) {
            result = result.replace(new RegExp(`\\{${key}\\}`, 'g'), value);
        }
        result = result
            .replace(/\/+/g, '/')
            .replace(/^\/|\/$/g, '')
            .replace(/\/\//g, '/');
        if (result.endsWith('/')) result = result.slice(0, -1);

        const resolved = result || 'attachments';
        if (this.settings.imagePathBase === 'note' && notePath) {
            return `${notePath}/${resolved}`;
        }
        return resolved;
    }

    private get settings(): ImageManagerSettings {
        return this.options.getSettings();
    }

    private readAndSave(imageFile: File, filename: string, editor: Editor, currentFile: TFile | null): void {
        void imageFile.arrayBuffer().then((buffer) => {
            return this.saveImage(new Uint8Array(buffer), imageFile.type, filename, editor, currentFile);
        }).catch((error: unknown) => {
            new Notice(`Image save failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
        });
    }

    private generateFileName(extension: string, currentFile: TFile | null): string {
        const noteName = currentFile ? getFileNameWithoutExt(currentFile.path) : '';
        return generateImageFileName(
            this.settings.imageNamingTemplate,
            extension,
            noteName,
            new Date(),
            this.pasteCounter++
        );
    }

    private async ensureUniquePath(directory: string, filename: string): Promise<string> {
        const extension = filename.split('.').pop() ?? '';
        const baseName = filename.replace(new RegExp(`\\.${extension}$`), '');
        let filePath = directory === '.' ? filename : `${directory}/${filename}`;
        let counter = 1;

        while (
            this.options.app.vault.getAbstractFileByPath(filePath) ||
            (await this.options.app.vault.adapter.exists(filePath))
        ) {
            const newName = `${baseName}-${counter}.${extension}`;
            filePath = directory === '.' ? newName : `${directory}/${newName}`;
            counter++;
        }
        return filePath;
    }

    private async ensureDirectory(directory: string): Promise<void> {
        if (!directory) return;
        const parts = directory.split('/');
        let current = '';
        for (const part of parts) {
            current = current ? `${current}/${part}` : part;
            if (!this.options.app.vault.getAbstractFileByPath(current)) {
                await this.options.app.vault.createFolder(current).catch(() => {});
            }
        }
    }

    private async saveImage(
        data: Uint8Array,
        mimeType: string,
        filename: string,
        editor: Editor,
        currentFile: TFile | null
    ): Promise<void> {
        const extension = this.mimeToExtension(mimeType);
        const directory = this.resolveImagePath(
            this.settings.imagePathTemplate || 'attachments',
            currentFile,
            filename
        );
        await this.ensureDirectory(directory);
        const filePath = await this.ensureUniquePath(directory, filename);
        const prepared = await this.prepareLocalData(data, mimeType, extension);
        const savedFile = await this.createImageFile(filePath, directory, filename, extension, prepared.data);
        const localReference = this.insertLocalReference(editor, currentFile, savedFile);

        if (this.settings.managedAutoUploadOnPaste) {
            void this.autoUpload(savedFile, localReference, prepared.data, prepared.compressed, editor, currentFile);
        }
    }

    private async prepareLocalData(
        data: Uint8Array,
        mimeType: string,
        extension: string
    ): Promise<{ data: ArrayBuffer; compressed: boolean }> {
        const original = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
        if (!this.settings.compressManagedPasteLocal || extension === 'svg') {
            return { data: original, compressed: false };
        }

        try {
            const blob = new Blob([data], { type: mimeType });
            const image = await this.blobToImage(blob);
            try {
                const canvas = createEl('canvas');
                canvas.width = image.naturalWidth;
                canvas.height = image.naturalHeight;
                const context = canvas.getContext('2d');
                if (!context) throw new Error('Canvas context unavailable');
                context.drawImage(image, 0, 0);

                const outputMime = extension === 'png' ? 'image/webp' : mimeType;
                const compressedBlob = await new Promise<Blob>((resolve, reject) => {
                    canvas.toBlob(
                        (result) => result ? resolve(result) : reject(new Error('Canvas toBlob failed')),
                        outputMime,
                        this.settings.compressQuality / 100
                    );
                });
                return { data: await compressedBlob.arrayBuffer(), compressed: true };
            } finally {
                URL.revokeObjectURL(image.src);
            }
        } catch {
            return { data: original, compressed: false };
        }
    }

    private async createImageFile(
        filePath: string,
        directory: string,
        filename: string,
        extension: string,
        data: ArrayBuffer
    ): Promise<TFile> {
        try {
            console.debug(`[ImageManager] Saving image to: ${filePath}`);
            return await this.options.app.vault.createBinary(filePath, data);
        } catch {
            console.warn(`[ImageManager] File conflict at ${filePath}, retrying with unique name`);
            const retryName = `${filename.replace(/\.[^.]+$/, '')}-${Date.now()}.${extension}`;
            const retryPath = await this.ensureUniquePath(directory, retryName);
            console.debug(`[ImageManager] Retrying with: ${retryPath}`);
            return this.options.app.vault.createBinary(retryPath, data);
        }
    }

    private insertLocalReference(editor: Editor, currentFile: TFile | null, savedFile: TFile): string {
        let reference: string;
        if (this.settings.managedPasteReferenceFormat === 'markdown') {
            const noteDirectory = currentFile?.parent?.path ?? '';
            const relativePath = noteDirectory
                ? this.computeRelativePath(noteDirectory, savedFile.path)
                : savedFile.path;
            reference = `![${savedFile.name}](${encodePathSegments(relativePath)})`;
        } else {
            reference = `![[${savedFile.name}]]`;
        }
        editor.replaceSelection(reference);
        return reference;
    }

    private async autoUpload(
        savedFile: TFile,
        localReference: string,
        data: ArrayBuffer,
        localDataCompressed: boolean,
        editor: Editor,
        currentFile: TFile | null
    ): Promise<void> {
        const hostingConfig = this.options.getDefaultHostingConfig();
        if (!hostingConfig) return;
        const attachmentFolder = savedFile.parent;
        const notice = new Notice(t('notice.autoUploading'), 0);

        try {
            const uploadSource = chooseManagedPasteUploadSource({
                localCompressed: localDataCompressed,
                uploadCompression: this.settings.compressBeforeUpload,
            });
            const result = uploadSource === 'saved-file'
                ? await this.options.uploadService.uploadFile(savedFile, hostingConfig)
                : await this.options.uploadService.uploadData(data, savedFile.name, hostingConfig, {
                    sourcePath: savedFile.path,
                });

            if (!result.success || !result.url) {
                notice.hide();
                new Notice(t('notice.autoUploadFailed', { error: result.error ?? 'Unknown' }), 5000);
                return;
            }

            const preparedReference = await this.options.uploadReferences.prepare(savedFile);
            const replaced = this.replaceLocalReference(
                editor,
                currentFile,
                savedFile,
                localReference,
                result.url,
                preparedReference
            );
            if (!replaced) throw new Error(t('notice.delegatedReferenceChanged'));

            await this.options.uploadReferences.replaceVaultReferences(
                savedFile,
                result.url,
                preparedReference,
                { ...(currentFile ? { skipFile: currentFile } : {}) }
            );

            if (!this.settings.managedKeepLocalCopy) {
                const overrides = currentFile
                    ? new Map([[currentFile.path, editor.getValue()]])
                    : new Map<string, string>();
                const localState = await scanLocalOrphans(
                    this.options.app,
                    this.settings.supportedExtensions,
                    overrides,
                    this.options.getIndeterminateImagePaths()
                );
                if (localState.orphans.some((file) => file === savedFile)) {
                    await this.options.app.fileManager.trashFile(savedFile);
                    await removeEmptyDirectParent(this.options.app.vault, attachmentFolder);
                } else {
                    notice.hide();
                    new Notice(t('notice.autoUploadSuccess'), 3000);
                    return;
                }
            }

            notice.hide();
            new Notice(t('notice.autoUploadSuccess'), 3000);
        } catch (error) {
            notice.hide();
            new Notice(t('notice.autoUploadFailed', {
                error: error instanceof Error ? error.message : 'Unknown',
            }), 5000);
        }
    }

    private replaceLocalReference(
        editor: Editor,
        currentFile: TFile | null,
        savedFile: TFile,
        localReference: string,
        url: string,
        preparedReference: PreparedUploadReference
    ): boolean {
        if (!currentFile) return false;
        const content = editor.getValue();
        const match = findExactManagedPasteReference(
            this.options.refConverter.parseReferences(content),
            localReference,
            (reference) => this.options.app.metadataCache.getFirstLinkpathDest(
                reference.format === 'markdown'
                    ? decodePathSegments(reference.path)
                    : reference.path,
                currentFile.path
            ) === savedFile
        );
        if (!match) return false;

        const replacement = preparedReference.render(url, match.altText);
        const start = this.offsetToEditorPosition(content, match.col);
        const end = this.offsetToEditorPosition(content, match.col + match.fullMatch.length);
        editor.replaceRange(replacement, start, end);
        return true;
    }

    private offsetToEditorPosition(content: string, offset: number): { line: number; ch: number } {
        const lines = content.substring(0, offset).split('\n');
        return { line: lines.length - 1, ch: lines[lines.length - 1]!.length };
    }

    private blobToImage(blob: Blob): Promise<HTMLImageElement> {
        return new Promise((resolve, reject) => {
            const image = new Image();
            image.onload = () => resolve(image);
            image.onerror = () => {
                URL.revokeObjectURL(image.src);
                reject(new Error('Failed to load image'));
            };
            image.src = URL.createObjectURL(blob);
        });
    }

    private mimeToExtension(mimeType: string): string {
        const extensions: Record<string, string> = {
            'image/png': 'png',
            'image/jpeg': 'jpg',
            'image/gif': 'gif',
            'image/webp': 'webp',
            'image/bmp': 'bmp',
            'image/svg+xml': 'svg',
            'image/tiff': 'tiff',
            'image/avif': 'avif',
        };
        return extensions[mimeType] ?? 'png';
    }

    private computeRelativePath(fromDirectory: string, toPath: string): string {
        const fromParts = fromDirectory.split('/').filter(Boolean);
        const toParts = toPath.split('/').filter(Boolean);
        let commonLength = 0;
        while (
            commonLength < fromParts.length &&
            commonLength < toParts.length &&
            fromParts[commonLength] === toParts[commonLength]
        ) {
            commonLength++;
        }
        const parentSegments = Array.from(
            { length: fromParts.length - commonLength },
            () => '..'
        );
        const result = [...parentSegments, ...toParts.slice(commonLength)].join('/');
        return result || toPath;
    }
}
