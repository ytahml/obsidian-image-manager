import { App, TFile } from 'obsidian';
import { RefConverter } from './ref-converter';
import type { ImageManagerSettings } from '../types';
import { decodePathSegments, encodePathSegments } from './path-utils';

export interface RenameResult {
    file: TFile;
    oldName: string;
    newName: string;
    notesUpdated: number;
}

export class BatchRename {
    private app: App;
    private refConverter: RefConverter;
    private settings: ImageManagerSettings;

    constructor(app: App, settings: ImageManagerSettings) {
        this.app = app;
        this.refConverter = new RefConverter(app);
        this.settings = settings;
    }

    /**
     * 重命名图片文件并同步更新所有引用
     */
    async renameImage(file: TFile, newName: string): Promise<RenameResult> {
        const oldName = file.name;
        const parentDir = file.parent?.path ?? '';
        const newPath = parentDir ? `${parentDir}/${newName}` : newName;

        // Update references BEFORE vault.rename() — Obsidian auto-updates links
        // after rename, which conflicts with our own updates
        const notesUpdated = await this.updateReferencesBeforeRename(file, oldName, newName);

        // Rename the file
        await this.app.vault.rename(file, newPath);

        const renamedFile = this.app.vault.getAbstractFileByPath(newPath);
        if (!(renamedFile instanceof TFile)) {
            throw new Error(`Failed to rename file: ${newPath}`);
        }

        return {
            file: renamedFile,
            oldName,
            newName,
            notesUpdated,
        };
    }

    /**
     * 在 vault.rename() 之前更新引用，避免与 Obsidian 内置链接更新器冲突
     * vault.rename() 会触发 Obsidian 自动更新 wiki 链接，导致我们的更新被覆盖
     */
    private async updateReferencesBeforeRename(file: TFile, oldName: string, newName: string): Promise<number> {
        const oldPath = file.path;
        const mdFiles = this.app.vault.getMarkdownFiles();
        let updatedCount = 0;

        for (const mdFile of mdFiles) {
            const content = await this.app.vault.cachedRead(mdFile);
            const refs = this.refConverter.parseReferences(content);

            let newContent = content;
            let changed = false;

            // Process in reverse order to preserve indices
            for (let i = refs.length - 1; i >= 0; i--) {
                const ref = refs[i]!;
                const logicalRefPath = ref.format === 'markdown'
                    ? decodePathSegments(ref.path)
                    : ref.path;
                const refName = logicalRefPath.split('/').pop() ?? logicalRefPath;

                if (refName === oldName || logicalRefPath === oldPath || logicalRefPath === oldName) {
                    const newRef = this.buildUpdatedRef(
                        { ...ref, path: logicalRefPath },
                        oldName,
                        newName,
                        oldPath
                    );
                    newContent =
                        newContent.substring(0, ref.col) +
                        newRef +
                        newContent.substring(ref.col + ref.fullMatch.length);
                    changed = true;
                }
            }

            if (changed) {
                await this.app.vault.process(mdFile, () => newContent);
                updatedCount++;
            }
        }

        return updatedCount;
    }

    /**
     * 修复 Obsidian 内置重命名后丢失目录路径的图片引用
     * Obsidian 的链接更新器会将 `![alt](assets/folder/old.png)` 变为 `![alt](new.png)`，
     * 丢失了相对路径中的目录部分
     */
    async fixBrokenImageRefs(oldPath: string, newPath: string): Promise<number> {
        const oldName = oldPath.split('/').pop() ?? oldPath;
        const newName = newPath.split('/').pop() ?? newPath;
        const oldBaseName = oldName.replace(/\.[^.]+$/, '');
        const newBaseName = newName.replace(/\.[^.]+$/, '');
        const mdFiles = this.app.vault.getMarkdownFiles();
        let updatedCount = 0;

        for (const mdFile of mdFiles) {
            const content = await this.app.vault.cachedRead(mdFile);
            const refs = this.refConverter.parseReferences(content);

            let newContent = content;
            let changed = false;

            for (let i = refs.length - 1; i >= 0; i--) {
                const ref = refs[i]!;

                if (ref.path !== newName && ref.path.split('/').pop() !== newName) continue;

                // Skip if reference already points to a valid file
                const decodedRefPath = ref.format === 'markdown'
                    ? decodePathSegments(ref.path)
                    : ref.path;
                // Try exact path, then resolve relative to note directory
                const noteDir = mdFile.parent?.path ?? '';
                const resolvedPath = noteDir ? `${noteDir}/${decodedRefPath}` : decodedRefPath;
                if (this.app.vault.getAbstractFileByPath(decodedRefPath) ||
                    this.app.vault.getAbstractFileByPath(resolvedPath)) continue;

                // Restore directory path
                // For moves (directory changed), use new location; for renames, use old directory
                const oldDir = oldPath.substring(0, oldPath.lastIndexOf('/'));
                const newDir = newPath.substring(0, newPath.lastIndexOf('/'));
                const dir = oldDir !== newDir ? newDir : oldDir;
                const absolutePath = dir ? `${dir}/${newName}` : newName;

                // Compute correct path: relative to note if imagePathBase is 'note'
                let correctPath = absolutePath;
                if (this.settings.imagePathBase === 'note' && ref.format === 'markdown') {
                    const noteDir = mdFile.parent?.path ?? '';
                    if (noteDir) {
                        correctPath = this.refConverter.computeRelativePath(noteDir, absolutePath);
                    }
                }
                if (decodedRefPath === correctPath) continue;

                // Update alt text if it was the old filename
                let altText = ref.altText;
                if (altText === oldBaseName || altText === oldName) {
                    altText = newBaseName;
                }

                const newRef =
                    ref.format === 'wiki'
                        ? altText
                            ? `![[${correctPath}|${altText}]]`
                            : `![[${correctPath}]]`
                        : `![${altText}](${encodePathSegments(correctPath)})`;

                newContent =
                    newContent.substring(0, ref.col) +
                    newRef +
                    newContent.substring(ref.col + ref.fullMatch.length);
                changed = true;
            }

            if (changed) {
                await this.app.vault.process(mdFile, () => newContent);
                updatedCount++;
            }
        }

        return updatedCount;
    }

    /** 构建更新后的引用字符串，保留原有目录路径 */
    private buildUpdatedRef(
        ref: { path: string; altText: string; format: string; fullMatch: string },
        oldName: string,
        newName: string,
        oldPath: string
    ): string {
        let newRefPath: string;
        if (ref.path === oldPath || ref.path === oldName) {
            // Full path match or bare filename — replace entire path
            const dir = oldPath.substring(0, oldPath.lastIndexOf('/'));
            newRefPath = dir ? `${dir}/${newName}` : newName;
        } else {
            // Filename match — preserve the reference's own directory
            const dir = ref.path.substring(0, ref.path.lastIndexOf('/'));
            newRefPath = dir ? `${dir}/${newName}` : newName;
        }

        if (ref.format === 'wiki') {
            return ref.altText ? `![[${newRefPath}|${ref.altText}]]` : `![[${newRefPath}]]`;
        }
        return `![${ref.altText}](${encodePathSegments(newRefPath)})`;
    }
}
