import { App, TFile } from 'obsidian';
import type { ImageFilter, SortBy, SortOrder } from '../types';
import { IMAGE_MIME_TYPES } from '../constants';

export class ImageScanner {
    private app: App;
    private supportedExtensions: Set<string>;

    constructor(app: App, extensions: string[]) {
        this.app = app;
        this.supportedExtensions = new Set(extensions.map((e) => e.toLowerCase()));
    }

    /** 获取库中所有图片文件 */
    getAllImages(): TFile[] {
        return this.app.vault.getFiles().filter((file) => this.isImageFile(file));
    }

    /** 判断文件是否为图片 */
    isImageFile(file: TFile): boolean {
        return this.supportedExtensions.has(file.extension.toLowerCase());
    }

    /** 按条件筛选图片 */
    filterImages(files: TFile[], filter: ImageFilter): TFile[] {
        return files.filter((file) => {
            if (filter.keyword && !file.name.toLowerCase().includes(filter.keyword.toLowerCase())) {
                return false;
            }
            if (filter.extensions?.length && !filter.extensions.includes(file.extension.toLowerCase())) {
                return false;
            }
            if (filter.minSize !== undefined && file.stat.size < filter.minSize) {
                return false;
            }
            if (filter.maxSize !== undefined && file.stat.size > filter.maxSize) {
                return false;
            }
            if (filter.directory && !file.path.startsWith(filter.directory)) {
                return false;
            }
            return true;
        });
    }

    /** 排序图片 */
    sortImages(files: TFile[], sortBy: SortBy, order: SortOrder): TFile[] {
        const sorted = [...files].sort((a, b) => {
            switch (sortBy) {
                case 'name':
                    return a.name.localeCompare(b.name);
                case 'size':
                    return a.stat.size - b.stat.size;
                case 'modified':
                    return a.stat.mtime - b.stat.mtime;
                case 'created':
                    return a.stat.ctime - b.stat.ctime;
                default:
                    return 0;
            }
        });
        return order === 'desc' ? sorted.reverse() : sorted;
    }

    /** 获取图片 MIME 类型 */
    getMimeType(file: TFile): string {
        return IMAGE_MIME_TYPES[file.extension.toLowerCase()] ?? 'application/octet-stream';
    }
}
