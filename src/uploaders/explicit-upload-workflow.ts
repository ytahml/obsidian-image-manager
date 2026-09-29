import type { App, TFile } from 'obsidian';
import type { ImageHostingConfig } from '../types';
import type { RefConverter } from '../utils/ref-converter';
import { UploadQueue, type QueueProgress, type QueueResult } from './upload-queue';
import type { UploadOperationResult, UploadService, UploadServiceOptions } from './upload-service';
import type { BatchReferenceResult, UploadedReference, UploadReferenceManager } from './upload-reference-manager';
import { createUploadPlan, isUploadSourceCurrent, snapshotUploadSource, type UploadPlan, type UploadScope } from './upload-scope';

export interface ImageUploadResult {
    operation: UploadOperationResult;
    reference?: string;
    replacedReferences: number;
}
export interface BatchUploadOptions {
    replaceReferences: boolean;
    referenceTemplate?: string;
    upload?: UploadServiceOptions;
}
export interface BatchUploadResult extends BatchReferenceResult {
    totalImages: number;
    successfulImages: number;
    failedImages: number;
    unusedImages: number;
    items: QueueResult[];
    skipped: UploadPlan['skipped'];
}

/** Explicit upload commands share identity, queue and safe all-Vault writeback. */
export class ExplicitUploadWorkflow {
    private busy = false;
    get isBusy(): boolean { return this.busy; }
    constructor(
        private readonly app: App,
        private readonly uploadService: UploadService,
        private readonly refConverter: RefConverter,
        private readonly uploadReferences: UploadReferenceManager,
    ) {}

    async uploadImage(file: TFile, hosting: ImageHostingConfig, replaceVaultReferences: boolean): Promise<ImageUploadResult> {
        this.begin();
        try {
            const source = snapshotUploadSource(file);
            const operation = await this.uploadService.uploadFile(file, hosting, {
                beforeAttempt: () => isUploadSourceCurrent(this.app, source),
            });
            if (!operation.success || !operation.url || !isUploadSourceCurrent(this.app, source)) {
                return { operation, replacedReferences: 0 };
            }
            const prepared = await this.uploadReferences.prepare(file);
            const reference = prepared.render(operation.url);
            const replacements = replaceVaultReferences ? await this.uploadReferences.replaceBatchReferences(
                [{ source, url: operation.url, prepared }], new Set(),
            ) : undefined;
            return { operation, reference, replacedReferences: replacements?.replacedReferences ?? 0 };
        } finally { this.busy = false; }
    }

    createPlan(scope: UploadScope, extensions: readonly string[]): Promise<UploadPlan> {
        return createUploadPlan(this.app, this.refConverter, scope, extensions);
    }

    async uploadPlan(plan: UploadPlan, hosting: ImageHostingConfig, options: BatchUploadOptions, onProgress?: (progress: QueueProgress) => void): Promise<BatchUploadResult> {
        this.begin();
        try {
            const queue = new UploadQueue(this.uploadService);
            queue.addSources(plan.sources);
            if (onProgress) queue.onProgressChange(onProgress);
            const items = await queue.startItems(hosting, options.upload, source => isUploadSourceCurrent(this.app, source));
            const uploaded: UploadedReference[] = [];
            const unused = new Set<string>();
            for (const item of items) {
                if (!item.operation.success || !item.operation.url) continue;
                if (!isUploadSourceCurrent(this.app, item.source)) { unused.add(item.source.path); continue; }
                if (!options.replaceReferences) continue;
                try {
                    uploaded.push({ source: item.source, url: item.operation.url,
                        prepared: await this.uploadReferences.prepare(item.source.file, options.referenceTemplate) });
                } catch { unused.add(item.source.path); }
            }
            const references = await this.uploadReferences.replaceBatchReferences(uploaded, new Set(plan.notes.map(note => note.path)));
            for (const item of items) {
                if (item.operation.success && !isUploadSourceCurrent(this.app, item.source)) unused.add(item.source.path);
            }
            const successfulImages = items.filter(item => item.operation.success && item.operation.url).length;
            return { ...references, totalImages: items.length, successfulImages, failedImages: items.length - successfulImages,
                unusedImages: unused.size, items, skipped: plan.skipped };
        } finally { this.busy = false; }
    }
    private begin(): void {
        if (this.busy) throw new Error('An explicit upload is already running');
        this.busy = true;
    }
}
