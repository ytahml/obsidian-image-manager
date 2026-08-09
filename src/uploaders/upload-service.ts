import type { App, TFile } from 'obsidian';
import type { ImageHostingConfig, UploadContext, UploadResult } from '../types';
import { ImageOptimizer } from '../utils/image-optimizer';
import { createUploader } from './uploader-factory';

export interface UploadOperationResult {
    hostingId: string;
    hostingType: ImageHostingConfig['type'];
    success: boolean;
    originalPath: string;
    attempts: number;
    url?: string;
    objectKey?: string;
    error?: string;
    originalSize?: number;
    uploadedSize?: number;
    cancelled?: boolean;
}

export interface UploadServiceOptions {
    maxRetries?: number;
    compressBeforeUpload?: boolean;
    compressQuality?: number;
    uploadPathTemplate?: string;
    beforeAttempt?: (attempt: number) => boolean | Promise<boolean>;
}

export interface UploadDefaults {
    compressBeforeUpload: boolean;
    compressQuality: number;
    uploadPathTemplate: string;
}

/**
 * One in-memory upload orchestration boundary for every upload entry point.
 * It deliberately publishes no persistent upload history: remote existence is
 * established only by a subsequent provider scan.
 */
export class UploadService {
    private readonly optimizer: ImageOptimizer;
    private readonly successListeners = new Set<(result: UploadOperationResult) => void>();

    constructor(
        private readonly app: App,
        private readonly getDefaults: () => UploadDefaults
    ) {
        this.optimizer = new ImageOptimizer(app);
    }

    onSuccess(listener: (result: UploadOperationResult) => void): () => void {
        this.successListeners.add(listener);
        return () => this.successListeners.delete(listener);
    }

    async uploadFile(
        file: TFile,
        hostingConfig: ImageHostingConfig,
        options: UploadServiceOptions = {}
    ): Promise<UploadOperationResult> {
        let data = await this.app.vault.readBinary(file);
        const originalSize = data.byteLength;
        const defaults = this.getDefaults();
        if (options.compressBeforeUpload ?? defaults.compressBeforeUpload) {
            const compressed = await this.optimizer.compressImage(file, options.compressQuality ?? defaults.compressQuality);
            data = compressed.data;
        }
        return this.uploadData(data, file.name, hostingConfig, {
            sourcePath: file.path,
        }, options, originalSize);
    }

    async uploadData(
        data: ArrayBuffer,
        filename: string,
        hostingConfig: ImageHostingConfig,
        context: UploadContext | undefined = undefined,
        options: UploadServiceOptions = {},
        originalSize: number = data.byteLength
    ): Promise<UploadOperationResult> {
        const maxRetries = Math.max(0, Math.floor(options.maxRetries ?? 0));
        const uploader = createUploader(
            hostingConfig,
            options.uploadPathTemplate ?? this.getDefaults().uploadPathTemplate
        );
        let attempts = 0;
        let lastResult: UploadResult | undefined;
        let lastError: unknown;

        while (attempts <= maxRetries) {
            let mayAttempt = true;
            try {
                mayAttempt = !options.beforeAttempt || await options.beforeAttempt(attempts + 1);
            } catch {
                mayAttempt = false;
            }
            if (!mayAttempt) {
                return {
                    hostingId: hostingConfig.id,
                    hostingType: hostingConfig.type,
                    success: false,
                    cancelled: true,
                    originalPath: lastResult?.originalPath ?? filename,
                    attempts,
                    error: 'Upload cancelled because the source transaction changed',
                    originalSize,
                    uploadedSize: data.byteLength,
                };
            }
            attempts++;
            try {
                const result = await uploader.upload(data, filename, context);
                lastResult = result;
                if (this.isSuccessfulNativeResult(result, hostingConfig)) {
                    const operation: UploadOperationResult = {
                        hostingId: hostingConfig.id,
                        hostingType: hostingConfig.type,
                        success: true,
                        originalPath: result.originalPath,
                        attempts,
                        url: result.url,
                        ...(result.objectKey ? { objectKey: result.objectKey } : {}),
                        originalSize,
                        uploadedSize: data.byteLength,
                    };
                    this.publishSuccess(operation);
                    return operation;
                }
            } catch (error) {
                lastError = error;
            }
        }

        return {
            hostingId: hostingConfig.id,
            hostingType: hostingConfig.type,
            success: false,
            originalPath: lastResult?.originalPath ?? filename,
            attempts,
            error: lastResult?.error ?? (lastError instanceof Error ? lastError.message : 'Upload failed'),
            originalSize,
            uploadedSize: data.byteLength,
        };
    }

    private isSuccessfulNativeResult(result: UploadResult, config: ImageHostingConfig): boolean {
        if (!result.success || !result.url) return false;
        return config.type === 'custom' || Boolean(result.objectKey);
    }

    private publishSuccess(result: UploadOperationResult): void {
        for (const listener of this.successListeners) listener(result);
    }
}
