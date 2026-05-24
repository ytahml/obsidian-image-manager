import { App, TFile } from 'obsidian';
import { ImageScanner } from './image-scanner';
import { MD_IMAGE_REGEX, WIKI_IMAGE_REGEX } from '../constants';

export interface OrphanResult {
    orphans: TFile[];
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
    async findOrphans(): Promise<OrphanResult> {
        const allImages = this.scanner.getAllImages();
        const referencedPaths = await this.getAllReferencedImages();

        const orphans = allImages.filter((file) => {
            // Check if the image name or path is referenced
            return !referencedPaths.has(file.name) && !referencedPaths.has(file.path);
        });

        return {
            orphans,
            total: allImages.length,
            referenced: allImages.length - orphans.length,
        };
    }

    /**
     * 获取所有笔记中引用的图片路径集合
     */
    private async getAllReferencedImages(): Promise<Set<string>> {
        const referenced = new Set<string>();
        const mdFiles = this.app.vault.getMarkdownFiles();

        for (const file of mdFiles) {
            const content = await this.app.vault.cachedRead(file);
            this.extractReferences(content, referenced);
        }

        return referenced;
    }

    /**
     * 从文本中提取所有图片引用路径
     */
    private extractReferences(text: string, result: Set<string>): void {
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
                    result.add(path);
                    // Also add just the filename for matching
                    const filename = path.split('/').pop();
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
