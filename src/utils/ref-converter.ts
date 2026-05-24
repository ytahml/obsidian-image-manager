import { App } from 'obsidian';
import type { ImageReference, ReferenceFormat } from '../types';
import { MD_IMAGE_REGEX, WIKI_IMAGE_REGEX } from '../constants';

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
    convertReference(ref: ImageReference, targetFormat: ReferenceFormat): string {
        if (ref.format === targetFormat) return ref.fullMatch;

        if (targetFormat === 'wiki') {
            // Markdown → Wiki
            const filename = ref.path.split('/').pop() ?? ref.path;
            if (ref.altText && ref.altText !== filename.replace(/\.[^.]+$/, '')) {
                return `![[${filename}|${ref.altText}]]`;
            }
            return `![[${filename}]]`;
        } else {
            // Wiki → Markdown
            const fallback = ref.path.split('/').pop()?.replace(/\.[^.]+$/, '') ?? '';
            const altText = ref.altText || fallback;
            return `![${altText}](${ref.path})`;
        }
    }

    /** 转换整个文本中的所有引用 */
    convertAllReferences(text: string, targetFormat: ReferenceFormat): string {
        const refs = this.parseReferences(text);
        let result = text;

        // Reverse order to preserve indices
        for (let i = refs.length - 1; i >= 0; i--) {
            const ref = refs[i]!;
            const converted = this.convertReference(ref, targetFormat);
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
