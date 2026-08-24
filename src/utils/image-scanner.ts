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
        return [...files].sort((left, right) => {
            const comparison = getSortComparison(left, right, sortBy);
            if (comparison !== 0) return order === 'asc' ? comparison : -comparison;
            return left.path.localeCompare(right.path);
        });
    }

    /** 获取图片 MIME 类型 */
    getMimeType(file: TFile): string {
        return IMAGE_MIME_TYPES[file.extension.toLowerCase()] ?? 'application/octet-stream';
    }
}

function getSortComparison(left: TFile, right: TFile, sortBy: SortBy): number {
    switch (sortBy) {
        case 'name':
            return left.name.localeCompare(right.name);
        case 'size':
            return left.stat.size - right.stat.size;
        case 'modified':
            return left.stat.mtime - right.stat.mtime;
        case 'created':
            return left.stat.ctime - right.stat.ctime;
        default:
            return 0;
    }
}
