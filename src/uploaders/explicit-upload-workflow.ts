import type { App, TFile } from 'obsidian';
import type { ImageHostingConfig, ImageReference } from '../types';
import type { RefConverter } from '../utils/ref-converter';
import { collectLocalNoteImages } from './note-images';
import { summarizeUploadError } from './upload-error';
import { UploadQueue, type QueueProgress } from './upload-queue';
import type { UploadOperationResult, UploadService } from './upload-service';
import type { PreparedUploadReference, UploadReferenceManager } from './upload-reference-manager';

export interface ImageUploadResult {
    operation: UploadOperationResult;
    reference?: string;
    replacedReferences: number;
}

export interface NoteUploadFailure {
    kind: 'missing-file' | 'upload-failed';
    fileName: string;
    error?: string;
    referenceCount: number;
}

export interface NoteUploadProgress {
    completedImages: number;
    totalImages: number;
    current: string;
}

export interface NoteUploadResult {
    totalReferences: number;
    successfulReferences: number;
    uploadedImages: number;
    failures: NoteUploadFailure[];
}

export interface BatchUploadResult {
    totalImages: number;
    successfulImages: number;
    operations: UploadOperationResult[];
}

interface ResolvedImageGroup {
    file: TFile;
    references: ImageReference[];
}

interface UploadedImageGroup extends ResolvedImageGroup {
    url: string;
    prepared: PreparedUploadReference;
}

/** Owns explicit single-image, note, and Vault upload workflows without UI effects. */
export class ExplicitUploadWorkflow {
    constructor(
        private readonly app: App,
        private readonly uploadService: UploadService,
        private readonly refConverter: RefConverter,
        private readonly uploadReferences: UploadReferenceManager
    ) {}

    async uploadImage(
        file: TFile,
        hosting: ImageHostingConfig,
        replaceVaultReferences: boolean
    ): Promise<ImageUploadResult> {
        const operation = await this.uploadService.uploadFile(file, hosting);
        if (!operation.success || !operation.url) {
            return { operation, replacedReferences: 0 };
        }

        const prepared = await this.uploadReferences.prepare(file);
        const reference = prepared.render(operation.url);
        const replacedReferences = replaceVaultReferences
            ? await this.uploadReferences.replaceVaultReferences(file, operation.url, prepared)
            : 0;
        return { operation, reference, replacedReferences };
    }

    async uploadNote(
        note: TFile,
        hosting: ImageHostingConfig,
        onProgress?: (progress: NoteUploadProgress) => void
    ): Promise<NoteUploadResult> {
        const { content, references } = await collectLocalNoteImages(this.app, note, this.refConverter);
        const failures: NoteUploadFailure[] = [];
        const groups = new Map<string, ResolvedImageGroup>();

        for (const item of references) {
            if (!item.file) {
                failures.push({
                    kind: 'missing-file',
                    fileName: item.reference.path,
                    referenceCount: 1,
                });
                continue;
            }
            const existing = groups.get(item.file.path);
            if (existing) existing.references.push(item.reference);
            else groups.set(item.file.path, { file: item.file, references: [item.reference] });
        }

        const resolvedGroups = Array.from(groups.values());
        const uploaded: UploadedImageGroup[] = [];
        let completedImages = 0;

        for (const group of resolvedGroups) {
            onProgress?.({ completedImages, totalImages: resolvedGroups.length, current: group.file.name });
            try {
                const operation = await this.uploadService.uploadFile(group.file, hosting);
                if (!operation.success || !operation.url) {
                    failures.push({
                        kind: 'upload-failed',
                        fileName: group.file.name,
                        error: summarizeUploadError(operation.error),
                        referenceCount: group.references.length,
                    });
                } else {
                    uploaded.push({
                        ...group,
                        url: operation.url,
                        prepared: await this.uploadReferences.prepare(group.file),
                    });
                }
            } catch (error) {
                failures.push({
                    kind: 'upload-failed',
                    fileName: group.file.name,
                    error: summarizeUploadError(error instanceof Error ? error.message : undefined),
                    referenceCount: group.references.length,
                });
            }
            completedImages++;
            onProgress?.({ completedImages, totalImages: resolvedGroups.length, current: group.file.name });
        }

        const replacements = uploaded.reduce<Array<{ reference: ImageReference; text: string }>>(
            (all, group) => {
                for (const reference of group.references) {
                    all.push({
                        reference,
                        text: group.prepared.render(
                            group.url,
                            reference.altText || group.file.name.replace(/\.[^.]+$/, '')
                        ),
                    });
                }
                return all;
            },
            []
        ).sort((a, b) => b.reference.col - a.reference.col);

        let newContent = content;
        for (const replacement of replacements) {
            const ref = replacement.reference;
            newContent = newContent.substring(0, ref.col) + replacement.text +
                newContent.substring(ref.col + ref.fullMatch.length);
        }

        if (replacements.length > 0) {
            await this.app.vault.process(note, () => newContent);
            for (const group of uploaded) {
                await this.uploadReferences.replaceVaultReferences(group.file, group.url, group.prepared, {
                    skipFile: note,
                });
            }
        }

        return {
            totalReferences: references.length,
            successfulReferences: replacements.length,
            uploadedImages: uploaded.length,
            failures,
        };
    }

    async uploadBatch(
        files: TFile[],
        hosting: ImageHostingConfig,
        onProgress?: (progress: QueueProgress) => void
    ): Promise<BatchUploadResult> {
        const queue = new UploadQueue(this.uploadService);
        queue.addFiles(files);
        if (onProgress) queue.onProgressChange(onProgress);
        const operations = await queue.start(hosting);
        return {
            totalImages: files.length,
            successfulImages: operations.length,
            operations,
        };
    }
}
