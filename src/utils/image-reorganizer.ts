import { App, TFile } from 'obsidian';
import { RefConverter } from './ref-converter';
import type { ImageManagerSettings, ReferenceFormat } from '../types';
import { joinPath } from './path-utils';

export interface ReorganizeResult {
    moved: number;
    skipped: number;
}

export class ImageReorganizer {
    private app: App;
    private refConverter: RefConverter;
    private settings: ImageManagerSettings;
    private resolveImagePath: (template: string, currentFile: TFile | null, filename: string) => string;

    constructor(
        app: App,
        settings: ImageManagerSettings,
        resolveImagePath: (template: string, currentFile: TFile | null, filename: string) => string
    ) {
        this.app = app;
        this.refConverter = new RefConverter(app);
        this.settings = settings;
        this.resolveImagePath = resolveImagePath;
    }

    /** 整理单篇笔记引用的图片 */
    async reorganizeNote(noteFile: TFile, convertFormat?: ReferenceFormat): Promise<ReorganizeResult> {
        const content = await this.app.vault.cachedRead(noteFile);
        const refs = this.refConverter.parseReferences(content);

        let newContent = content;
        let moved = 0;
        let skipped = 0;
        let converted = 0;

        // Process in reverse order to preserve indices
        for (let i = refs.length - 1; i >= 0; i--) {
            const ref = refs[i]!;

            // Skip external URLs
            if (ref.path.startsWith('http://') || ref.path.startsWith('https://')) {
                continue;
            }

            const imageFile = this.resolveImageFromRef(ref.path);
            if (!imageFile) {
                skipped++;
                continue;
            }

            const targetDir = this.resolveImagePath(
                this.settings.imagePathTemplate || 'attachments',
                noteFile,
                imageFile.name
            );
            const targetPath = joinPath(targetDir, imageFile.name);

            // Determine the output format: use convertFormat if provided, otherwise keep original
            const outputFormat: ReferenceFormat = convertFormat ?? ref.format;
            const needsMove = imageFile.path !== targetPath;
            const needsFormatChange = convertFormat !== undefined && ref.format !== convertFormat;

            // Skip if nothing needs to change
            if (!needsMove && !needsFormatChange) {
                skipped++;
                continue;
            }

            // Move file if needed
            let finalPath = imageFile.path;
            if (needsMove) {
                await this.ensureDirectory(targetDir);
                finalPath = await this.ensureUniquePath(targetPath);
                await this.app.vault.rename(imageFile, finalPath);
                moved++;
            }

            // Build new reference with the output format
            let newRef: string;
            if (outputFormat === 'wiki') {
                const fileName = finalPath.split('/').pop() ?? finalPath;
                newRef = ref.altText ? `![[${fileName}|${ref.altText}]]` : `![[${fileName}]]`;
            } else {
                const encodedPath = finalPath.split('/').map(encodeURIComponent).join('/');
                newRef = `![${ref.altText}](${encodedPath})`;
            }

            if (newRef !== ref.fullMatch) {
                newContent =
                    newContent.substring(0, ref.col) +
                    newRef +
                    newContent.substring(ref.col + ref.fullMatch.length);
                if (needsFormatChange) converted++;
            }
        }

        if (moved > 0 || converted > 0) {
            await this.app.vault.process(noteFile, () => newContent);
            if (moved > 0) {
                await this.updateOtherNotes(noteFile);
            }
        }

        return { moved, skipped };
    }

    /** 整理文件夹内所有笔记引用的图片 */
    async reorganizeFolder(folderPath: string, convertFormat?: ReferenceFormat): Promise<ReorganizeResult & { notes: number }> {
        const mdFiles = this.app.vault.getMarkdownFiles().filter((f) => f.path.startsWith(folderPath + '/') || f.path.startsWith(folderPath));

        let totalMoved = 0;
        let totalSkipped = 0;
        let notesProcessed = 0;

        for (const mdFile of mdFiles) {
            const result = await this.reorganizeNote(mdFile, convertFormat);
            totalMoved += result.moved;
            totalSkipped += result.skipped;
            if (result.moved > 0 || result.skipped > 0) {
                notesProcessed++;
            }
        }

        return { moved: totalMoved, skipped: totalSkipped, notes: notesProcessed };
    }

    /** 从引用路径解析出图片 TFile */
    private resolveImageFromRef(refPath: string): TFile | null {
        // Try decoding URL-encoded path
        let decodedPath: string;
        try {
            decodedPath = decodeURIComponent(refPath);
        } catch {
            decodedPath = refPath;
        }

        // Try exact path match
        const byPath = this.app.vault.getAbstractFileByPath(decodedPath);
        if (byPath instanceof TFile && this.isImageFile(byPath)) {
            return byPath;
        }

        // Try by filename across the vault
        const filename = decodedPath.split('/').pop() ?? decodedPath;
        const allImages = this.app.vault.getFiles().filter((f) => this.isImageFile(f));
        const match = allImages.find((f) => f.name === filename || f.path === decodedPath);
        return match ?? null;
    }

    private isImageFile(file: TFile): boolean {
        return this.settings.supportedExtensions.includes(file.extension.toLowerCase());
    }

    private buildRefPath(vaultPath: string, format: 'wiki' | 'markdown'): string {
        if (format === 'wiki') {
            return vaultPath.split('/').pop() ?? vaultPath;
        }
        // Markdown: URL-encode each path segment
        return vaultPath.split('/').map(encodeURIComponent).join('/');
    }

    private async ensureDirectory(dirPath: string): Promise<void> {
        const parts = dirPath.split('/');
        let current = '';
        for (const part of parts) {
            current = current ? `${current}/${part}` : part;
            if (!this.app.vault.getAbstractFileByPath(current)) {
                await this.app.vault.createFolder(current).catch(() => {});
            }
        }
    }

    private async ensureUniquePath(filePath: string): Promise<string> {
        if (!this.app.vault.getAbstractFileByPath(filePath)) {
            return filePath;
        }

        const ext = filePath.split('.').pop() ?? '';
        const baseName = filePath.replace(new RegExp(`\\.${ext}$`), '');
        let counter = 1;
        let newPath = `${baseName}-${counter}.${ext}`;

        while (this.app.vault.getAbstractFileByPath(newPath)) {
            counter++;
            newPath = `${baseName}-${counter}.${ext}`;
        }

        return newPath;
    }

    /** 更新其他笔记中对已移动图片的引用 */
    private async updateOtherNotes(excludeNote: TFile): Promise<void> {
        // This is a best-effort update for other notes that might reference the moved images
        // We scan all markdown files and check if any reference points to a file that no longer exists
        // but could be found by filename
        const mdFiles = this.app.vault.getMarkdownFiles().filter((f) => f.path !== excludeNote.path);

        for (const mdFile of mdFiles) {
            const content = await this.app.vault.cachedRead(mdFile);
            const refs = this.refConverter.parseReferences(content);
            let newContent = content;
            let changed = false;

            for (let i = refs.length - 1; i >= 0; i--) {
                const ref = refs[i]!;
                if (ref.path.startsWith('http://') || ref.path.startsWith('https://')) continue;

                let decodedPath: string;
                try {
                    decodedPath = decodeURIComponent(ref.path);
                } catch {
                    decodedPath = ref.path;
                }

                // If the referenced file exists at its current path, no update needed
                if (this.app.vault.getAbstractFileByPath(decodedPath)) continue;

                // Try to find the file by name
                const filename = decodedPath.split('/').pop() ?? decodedPath;
                const allImages = this.app.vault.getFiles().filter((f) => this.isImageFile(f));
                const match = allImages.find((f) => f.name === filename);
                if (!match) continue;

                // Build new reference
                const newRefPath = this.buildRefPath(match.path, ref.format);
                let newRef: string;
                if (ref.format === 'wiki') {
                    const fileName = match.path.split('/').pop() ?? match.path;
                    newRef = ref.altText ? `![[${fileName}|${ref.altText}]]` : `![[${fileName}]]`;
                } else {
                    newRef = `![${ref.altText}](${newRefPath})`;
                }

                newContent =
                    newContent.substring(0, ref.col) +
                    newRef +
                    newContent.substring(ref.col + ref.fullMatch.length);
                changed = true;
            }

            if (changed) {
                await this.app.vault.process(mdFile, () => newContent);
            }
        }
    }
}
