import type { TFile } from 'obsidian';
import type { ImageHostingConfig } from '../types';
import type { UploadOperationResult, UploadService, UploadServiceOptions } from './upload-service';
import { snapshotUploadSource, type UploadSource } from './upload-scope';

export interface QueueItem {
    source: UploadSource;
    status: 'pending' | 'uploading' | 'done' | 'failed';
    operation?: UploadOperationResult;
}
export interface QueueResult { source: UploadSource; operation: UploadOperationResult }
export interface QueueProgress { total: number; completed: number; failed: number; current: string }
const MAX_RETRIES = 3;
const DEFAULT_CONCURRENCY = 3;

export class UploadQueue {
    private items: QueueItem[] = [];
    private onProgress?: (progress: QueueProgress) => void;
    constructor(private readonly uploadService: UploadService) {}

    addFiles(files: TFile[]): void { this.addSources(files.map(snapshotUploadSource)); }
    addSources(sources: readonly UploadSource[]): void {
        for (const source of sources) {
            if (!this.items.some(item => item.source.path === source.path)) {
                this.items.push({ source, status: 'pending' });
            }
        }
    }
    onProgressChange(callback: (progress: QueueProgress) => void): void { this.onProgress = callback; }

    /** Compatibility for callers that only need successful operations. */
    async start(hosting: ImageHostingConfig): Promise<UploadOperationResult[]> {
        return (await this.startItems(hosting)).map(item => item.operation).filter(op => op.success);
    }
    async startItems(
        hosting: ImageHostingConfig,
        options: UploadServiceOptions = {},
        isCurrent: (source: UploadSource) => boolean = () => true,
    ): Promise<QueueResult[]> {
        const worker = async () => {
            while (true) {
                const item = this.items.find(entry => entry.status === 'pending');
                if (!item) return;
                item.status = 'uploading';
                this.reportProgress();
                try {
                    if (!isCurrent(item.source)) {
                        item.operation = this.failure(hosting, item.source, true);
                    } else {
                        item.operation = await this.uploadService.uploadFile(item.source.file, hosting, {
                            ...options, maxRetries: MAX_RETRIES,
                            beforeAttempt: async attempt => isCurrent(item.source) &&
                                (!options.beforeAttempt || await options.beforeAttempt(attempt)),
                        });
                    }
                } catch {
                    item.operation = this.failure(hosting, item.source, false);
                }
                item.status = item.operation.success && item.operation.url ? 'done' : 'failed';
                this.reportProgress();
            }
        };
        await Promise.all(Array.from({ length: DEFAULT_CONCURRENCY }, () => worker()));
        return this.items.map(item => ({ source: item.source, operation: item.operation! }));
    }
    getProgress(): QueueProgress {
        return {
            total: this.items.length,
            completed: this.items.filter(item => item.status === 'done' || item.status === 'failed').length,
            failed: this.items.filter(item => item.status === 'failed').length,
            current: this.items.find(item => item.status === 'uploading')?.source.file.name ?? '',
        };
    }
    private failure(hosting: ImageHostingConfig, source: UploadSource, cancelled: boolean): UploadOperationResult {
        return { success: false, cancelled, hostingId: hosting.id, hostingType: hosting.type,
            originalPath: source.path, attempts: 0, error: cancelled ? 'Source changed' : 'Upload failed' };
    }
    private reportProgress(): void { this.onProgress?.(this.getProgress()); }
}
