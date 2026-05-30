import { App, TFile } from 'obsidian';
import type { ImageReference, ReferenceFormat } from '../types';
import { MD_IMAGE_REGEX, WIKI_IMAGE_REGEX } from '../constants';
import { encodePathSegments } from './path-utils';

export class RefConverter {
    private app: App;

    constructor(app: App) {
        this.app = app;
    }

    /** 解析文本中的所有图片引用 */
    parseReferences(text: string): ImageReference[] {
        const refs: ImageReference[] = [];
        let match: RegExpExecArray | null;

        // Reset lastIndex
        MD_IMAGE_REGEX.lastIndex = 0;
        WIKI_IMAGE_REGEX.lastIndex = 0;

        // Parse Markdown references
        while ((match = MD_IMAGE_REGEX.exec(text)) !== null) {
            const line = text.substring(0, match.index).split('\n').length - 1;
            refs.push({
                fullMatch: match[0],
                altText: match[1] ?? '',
                path: match[2] ?? '',
                format: 'markdown',
                line,
                col: match.index,
            });
        }

        // Parse Wiki references
        while ((match = WIKI_IMAGE_REGEX.exec(text)) !== null) {
            const line = text.substring(0, match.index).split('\n').length - 1;
            refs.push({
                fullMatch: match[0],
                altText: match[2] ?? '',
                path: match[1] ?? '',
                format: 'wiki',
                line,
                col: match.index,
            });
        }

        // Sort by position
        refs.sort((a, b) => a.col - b.col);
        return refs;
    }

    /** 将单个引用转换为目标格式 */
    convertReference(ref: ImageReference, targetFormat: ReferenceFormat, noteFile?: TFile): string {
        if (ref.format === targetFormat) return ref.fullMatch;

        if (targetFormat === 'wiki') {
            // Markdown → Wiki: just use filename
            const filename = ref.path.split('/').pop() ?? ref.path;
            const baseName = filename.replace(/\.[^.]+$/, '');
            if (ref.altText && ref.altText !== baseName) {
                return `![[${filename}|${ref.altText}]]`;
            }
            return `![[${filename}]]`;
        } else {
            // Wiki → Markdown: resolve full path, then make relative to note
            let resolvedPath = ref.path;
            if (!ref.path.includes('/')) {
                const resolved = this.resolveImagePath(ref.path);
                if (resolved) {
                    resolvedPath = resolved;
                }
            }
            // Make path relative to the note's directory
            if (noteFile) {
                const noteDir = noteFile.parent?.path ?? '';
                if (noteDir) {
                    resolvedPath = this.computeRelativePath(noteDir, resolvedPath);
                }
            }
            const encodedPath = encodePathSegments(resolvedPath);
            const filename = resolvedPath.split('/').pop() ?? resolvedPath;
            const baseName = filename.replace(/\.[^.]+$/, '');
            const altText = ref.altText && ref.altText !== baseName ? ref.altText : baseName;
            return `![${altText}](${encodedPath})`;
        }
    }

    /** 计算从 fromDir 到 toPath 的相对路径 */
    private computeRelativePath(fromDir: string, toPath: string): string {
        const fromParts = fromDir.split('/').filter(Boolean);
        const toParts = toPath.split('/').filter(Boolean);

        // Find common prefix length
        let commonLen = 0;
        while (commonLen < fromParts.length && commonLen < toParts.length && fromParts[commonLen] === toParts[commonLen]) {
            commonLen++;
        }

        // Go up from fromDir to the common ancestor
        const upCount = fromParts.length - commonLen;
        const ups: string[] = Array.from({ length: upCount }, () => '..');
        // Then go down to the target
        const downs = toParts.slice(commonLen);

        const result = [...ups, ...downs].join('/');
        return result || toPath;
    }

    /** 通过文件名在库中查找图片文件的完整路径 */
    private resolveImagePath(filename: string): string | null {
        const files = this.app.vault.getFiles();
        const match = files.find((f) => f.name === filename);
        return match?.path ?? null;
    }

    /** 转换整个文本中的所有引用 */
    convertAllReferences(text: string, targetFormat: ReferenceFormat, noteFile?: TFile): string {
        const refs = this.parseReferences(text);
        let result = text;

        // Reverse order to preserve indices
        for (let i = refs.length - 1; i >= 0; i--) {
            const ref = refs[i]!;
            const converted = this.convertReference(ref, targetFormat, noteFile);
            result = result.substring(0, ref.col) + converted + result.substring(ref.col + ref.fullMatch.length);
        }

        return result;
    }

    /** 统计文件中的引用数量 */
    countReferences(text: string): { markdown: number; wiki: number } {
        MD_IMAGE_REGEX.lastIndex = 0;
        WIKI_IMAGE_REGEX.lastIndex = 0;
        return {
            markdown: (text.match(new RegExp(MD_IMAGE_REGEX.source, 'gi')) ?? []).length,
            wiki: (text.match(new RegExp(WIKI_IMAGE_REGEX.source, 'gi')) ?? []).length,
        };
    }
}
