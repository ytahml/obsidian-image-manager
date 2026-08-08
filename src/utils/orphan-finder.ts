import { App, TFile, normalizePath } from 'obsidian';
import { ImageScanner } from './image-scanner';
import { MD_IMAGE_REGEX, WIKI_IMAGE_REGEX } from '../constants';

export interface OrphanResult {
    orphans: TFile[];
    indeterminate: TFile[];
    total: number;
    referenced: number;
}

export class OrphanFinder {
    private app: App;
    private scanner: ImageScanner;

    constructor(app: App, supportedExtensions: string[]) {
        this.app = app;
        this.scanner = new ImageScanner(app, supportedExtensions);
    }

    /**
     * 查找所有未被任何笔记引用的孤立图片
     */
    async findOrphans(contentOverrides: ReadonlyMap<string, string> = new Map()): Promise<OrphanResult> {
        const allImages = this.scanner.getAllImages();
        const referencedPaths = await this.getAllReferencedImages(contentOverrides);

        const orphans = allImages.filter((file) => {
            // Check if the image name or path is referenced
            return !referencedPaths.has(file.name) && !referencedPaths.has(file.path);
        });

        return {
            orphans,
            indeterminate: [],
            total: allImages.length,
            referenced: allImages.length - orphans.length,
        };
    }

    /**
     * 获取所有笔记中引用的图片路径集合
     */
    private async getAllReferencedImages(contentOverrides: ReadonlyMap<string, string>): Promise<Set<string>> {
        const referenced = new Set<string>();
        const mdFiles = this.app.vault.getMarkdownFiles();

        for (const file of mdFiles) {
            const content = contentOverrides.get(file.path) ?? await this.app.vault.cachedRead(file);
            const noteDir = file.path.substring(0, file.path.lastIndexOf('/'));
            this.extractReferences(content, referenced, noteDir);
        }

        return referenced;
    }

    /**
     * 获取引用指定图片的笔记路径和所有引用行号列表
     */
    async getReferencingNotes(file: TFile): Promise<Array<{ path: string; lines: number[] }>> {
        const notes: Array<{ path: string; lines: number[] }> = [];
        const mdFiles = this.app.vault.getMarkdownFiles();

        for (const mdFile of mdFiles) {
            const content = await this.app.vault.cachedRead(mdFile);
            const lines = this.findReferenceLines(content, file, mdFile.path);
            if (lines.length > 0) {
                notes.push({ path: mdFile.path, lines });
            }
        }

        return notes;
    }

    private findReferenceLines(text: string, file: TFile, notePath: string): number[] {
        const noteDir = notePath.substring(0, notePath.lastIndexOf('/'));
        const result: number[] = [];

        // Check markdown references
        let match: RegExpExecArray | null;
        MD_IMAGE_REGEX.lastIndex = 0;
        while ((match = MD_IMAGE_REGEX.exec(text)) !== null) {
            const path = match[2]?.trim();
            if (path && !path.startsWith('http://') && !path.startsWith('https://')) {
                const decoded = this.tryDecode(path);
                if (decoded === file.path || decoded === file.name) {
                    result.push(text.substring(0, match.index).split('\n').length - 1);
                } else if (decoded.startsWith('../') || decoded.startsWith('./') || (!decoded.startsWith('/') && decoded.includes('/'))) {
                    if (this.resolveRelative(noteDir, decoded) === file.path) {
                        result.push(text.substring(0, match.index).split('\n').length - 1);
                    }
                }
            }
        }

        // Check wiki references
        WIKI_IMAGE_REGEX.lastIndex = 0;
        while ((match = WIKI_IMAGE_REGEX.exec(text)) !== null) {
            const path = match[1]?.trim();
            if (path && !path.startsWith('http://') && !path.startsWith('https://')) {
                if (path === file.path || path === file.name) {
                    result.push(text.substring(0, match.index).split('\n').length - 1);
                }
            }
        }

        return result;
    }

    private resolveRelative(baseDir: string, relativePath: string): string {
        const baseParts = baseDir.split('/').filter(Boolean);
        const relParts = relativePath.split('/').filter(Boolean);
        const parts = [...baseParts];
        for (const part of relParts) {
            if (part === '..') {
                parts.pop();
            } else if (part !== '.') {
                parts.push(part);
            }
        }
        return normalizePath(parts.join('/'));
    }

    private tryDecode(path: string): string {
        try { return decodeURIComponent(path); } catch { return path; }
    }

    /**
     * 从文本中提取所有图片引用路径
     */
    private extractReferences(text: string, result: Set<string>, noteDir: string): void {
        let match: RegExpExecArray | null;

        // Reset lastIndex
        MD_IMAGE_REGEX.lastIndex = 0;
        WIKI_IMAGE_REGEX.lastIndex = 0;

        // Markdown references: ![alt](path)
        while ((match = MD_IMAGE_REGEX.exec(text)) !== null) {
            const path = match[2]?.trim();
            if (path) {
                // Skip external URLs
                if (!path.startsWith('http://') && !path.startsWith('https://')) {
                    const decoded = this.tryDecode(path);
                    result.add(decoded);
                    // Resolve relative paths to absolute vault paths
                    if (decoded.startsWith('../') || decoded.startsWith('./') || (!decoded.startsWith('/') && decoded.includes('/'))) {
                        result.add(this.resolveRelative(noteDir, decoded));
                    }
                    // Also add just the filename for matching
                    const filename = decoded.split('/').pop();
                    if (filename) result.add(filename);
                }
            }
        }

        // Wiki references: ![[path]] or ![[path|alt]]
        while ((match = WIKI_IMAGE_REGEX.exec(text)) !== null) {
            const path = match[1]?.trim();
            if (path) {
                // Skip external URLs
                if (!path.startsWith('http://') && !path.startsWith('https://')) {
                    result.add(path);
                    const filename = path.split('/').pop();
                    if (filename) result.add(filename);
                }
            }
        }
    }
}
