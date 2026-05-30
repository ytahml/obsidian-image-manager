import { App, TFile } from 'obsidian';
import { RefConverter } from './ref-converter';

export interface RenameResult {
    file: TFile;
    oldName: string;
    newName: string;
    notesUpdated: number;
}

export class BatchRename {
    private app: App;
    private refConverter: RefConverter;

    constructor(app: App) {
        this.app = app;
        this.refConverter = new RefConverter(app);
    }

    /**
     * 重命名图片文件并同步更新所有引用
     */
    async renameImage(file: TFile, newName: string): Promise<RenameResult> {
        const oldName = file.name;
        const parentDir = file.parent?.path ?? '';
        const newPath = parentDir ? `${parentDir}/${newName}` : newName;

        // Rename the file
        await this.app.vault.rename(file, newPath);

        // Update all references in markdown files
        const notesUpdated = await this.updateReferences(oldName, newName, file.path, newPath);

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
     * 更新所有笔记中对旧文件名的引用
     */
    private async updateReferences(
        oldName: string,
        newName: string,
        oldPath: string,
        newPath: string
    ): Promise<number> {
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
                const refName = ref.path.split('/').pop() ?? ref.path;

                if (refName === oldName || ref.path === oldPath || ref.path === oldName) {
                    // Build new reference
                    let newRefPath = ref.path;
                    if (ref.path === oldPath) {
                        newRefPath = newPath;
                    } else if (refName === oldName) {
                        // Replace just the filename part
                        const dir = ref.path.substring(0, ref.path.lastIndexOf('/'));
                        newRefPath = dir ? `${dir}/${newName}` : newName;
                    }

                    let newRef: string;
                    if (ref.format === 'wiki') {
                        if (ref.altText) {
                            newRef = `![[${newRefPath}|${ref.altText}]]`;
                        } else {
                            newRef = `![[${newRefPath}]]`;
                        }
                    } else {
                        newRef = `![${ref.altText}](${newRefPath})`;
                    }

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
}
