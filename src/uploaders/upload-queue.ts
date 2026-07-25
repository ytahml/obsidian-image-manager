import type { TFile } from 'obsidian';
import type { ImageHostingConfig } from '../types';
import { type UploadOperationResult, UploadService } from './upload-service';

export interface QueueItem {
    file: TFile;
    status: 'pending' | 'uploading' | 'done' | 'failed';
    url?: string;
    error?: string;
}

export interface QueueProgress {
    total: number;
    completed: number;
    failed: number;
    current: string;
}

const MAX_RETRIES = 3;
const DEFAULT_CONCURRENCY = 3;

export class UploadQueue {
    private items: QueueItem[] = [];
    private concurrency: number;
    private onProgress?: (progress: QueueProgress) => void;
    private onComplete?: (results: QueueItem[]) => void;

    constructor(private readonly uploadService: UploadService) {
        this.concurrency = DEFAULT_CONCURRENCY;
    }

    /**
     * 添加文件到上传队列
     */
    addFiles(files: TFile[]): void {
        for (const file of files) {
            // Avoid duplicates
            if (!this.items.some((item) => item.file.path === file.path)) {
                this.items.push({
                    file,
                    status: 'pending',
                });
            }
        }
    }

    /**
     * 设置进度回调
     */
    onProgressChange(callback: (progress: QueueProgress) => void): void {
        this.onProgress = callback;
    }

    /**
     * 设置完成回调
     */
    onCompleteChange(callback: (results: QueueItem[]) => void): void {
        this.onComplete = callback;
    }

    /**
     * 开始处理队列
     */
    async start(hostingConfig: ImageHostingConfig): Promise<UploadOperationResult[]> {
        const results: UploadOperationResult[] = [];

        // Start workers
        const workers: Promise<void>[] = [];
        for (let i = 0; i < this.concurrency; i++) {
            workers.push(this.worker(hostingConfig, results));
        }

        await Promise.all(workers);
        this.onComplete?.(this.items);
        return results;
    }

    /**
     * 获取当前进度
     */
    getProgress(): QueueProgress {
        const completed = this.items.filter((i) => i.status === 'done').length;
        const failed = this.items.filter((i) => i.status === 'failed').length;
        const current = this.items.find((i) => i.status === 'uploading');
        return {
            total: this.items.length,
            completed,
            failed,
            current: current?.file.name ?? '',
        };
    }

    /**
     * 清空队列
     */
    clear(): void {
        this.items = [];
    }

    private async worker(
        hostingConfig: ImageHostingConfig,
        results: UploadOperationResult[]
    ): Promise<void> {
        while (true) {
            const item = this.items.find((i) => i.status === 'pending');
            if (!item) break;

            item.status = 'uploading';
            this.reportProgress();

            try {
                const result = await this.uploadService.uploadFile(item.file, hostingConfig, {
                    maxRetries: MAX_RETRIES,
                });
                if (result.success && result.url) {
                    item.status = 'done';
                    item.url = result.url;
                    results.push(result);
                } else {
                    throw new Error(result.error ?? 'Upload failed');
                }
            } catch (e) {
                item.status = 'failed';
                item.error = e instanceof Error ? e.message : 'Unknown error';
            }

            this.reportProgress();
        }
    }

    private reportProgress(): void {
        if (this.onProgress) {
            this.onProgress(this.getProgress());
        }
    }
}
