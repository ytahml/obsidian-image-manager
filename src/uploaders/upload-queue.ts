import { App, TFile } from 'obsidian';
import type { ImageHostingConfig, ImageManagerSettings } from '../types';
import type { UploaderBase } from './uploader-base';
import { createUploader } from './uploader-factory';
import { ImageOptimizer } from '../utils/image-optimizer';

export interface QueueItem {
    file: TFile;
    status: 'pending' | 'uploading' | 'done' | 'failed';
    url?: string;
    error?: string;
    retries: number;
}

export interface UploadHistoryEntry {
    timestamp: number;
    fileName: string;
    filePath: string;
    hostingName: string;
    url: string;
    originalSize: number;
    uploadedSize: number;
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
    private app: App;
    private settings: ImageManagerSettings;
    private optimizer: ImageOptimizer;
    private items: QueueItem[] = [];
    private running = 0;
    private concurrency: number;
    private onProgress?: (progress: QueueProgress) => void;
    private onComplete?: (results: QueueItem[]) => void;

    constructor(app: App, settings: ImageManagerSettings) {
        this.app = app;
        this.settings = settings;
        this.optimizer = new ImageOptimizer(app);
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
                    retries: 0,
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
    async start(hostingConfig: ImageHostingConfig): Promise<UploadHistoryEntry[]> {
        const uploader = createUploader(hostingConfig, this.settings.uploadPathTemplate);
        const history: UploadHistoryEntry[] = [];

        // Start workers
        const workers: Promise<void>[] = [];
        for (let i = 0; i < this.concurrency; i++) {
            workers.push(this.worker(uploader, hostingConfig, history));
        }

        await Promise.all(workers);
        this.onComplete?.(this.items);
        return history;
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
        uploader: UploaderBase,
        hostingConfig: ImageHostingConfig,
        history: UploadHistoryEntry[]
    ): Promise<void> {
        while (true) {
            const item = this.items.find((i) => i.status === 'pending');
            if (!item) break;

            item.status = 'uploading';
            this.reportProgress();

            try {
                let data = await this.app.vault.readBinary(item.file);

                // Compress if enabled
                if (this.settings.autoCompress) {
                    const result = await this.optimizer.compressImage(item.file, this.settings.compressQuality);
                    data = result.data;
                }

                const result = await uploader.upload(data, item.file.name, {
                    sourcePath: item.file.path,
                });

                if (result.success && result.url) {
                    item.status = 'done';
                    item.url = result.url;
                    history.push({
                        timestamp: Date.now(),
                        fileName: item.file.name,
                        filePath: item.file.path,
                        hostingName: hostingConfig.name,
                        url: result.url,
                        originalSize: item.file.stat.size,
                        uploadedSize: data.byteLength,
                    });
                } else {
                    throw new Error(result.error ?? 'Upload failed');
                }
            } catch (e) {
                if (item.retries < MAX_RETRIES) {
                    item.retries++;
                    item.status = 'pending'; // Retry
                } else {
                    item.status = 'failed';
                    item.error = e instanceof Error ? e.message : 'Unknown error';
                }
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
