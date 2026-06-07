import { TFile, App } from 'obsidian';

export interface OptimizeResult {
    data: ArrayBuffer;
    originalSize: number;
    optimizedSize: number;
    format: string;
}

export class ImageOptimizer {
    private app: App;

    constructor(app: App) {
        this.app = app;
    }

    /**
     * 压缩图片，返回压缩后的二进制数据
     * 使用 Canvas API 进行浏览器端压缩
     */
    async compressImage(file: TFile, quality: number): Promise<OptimizeResult> {
        const originalData = await this.app.vault.readBinary(file);
        const ext = file.extension.toLowerCase();

        // SVG 不支持 canvas 压缩
        if (ext === 'svg') {
            return { data: originalData, originalSize: originalData.byteLength, optimizedSize: originalData.byteLength, format: 'svg' };
        }

        const mimeType = this.getMimeType(ext);
        const qualityNorm = Math.max(0, Math.min(1, quality / 100));

        const blob = new Blob([originalData], { type: mimeType });
        const img = await this.blobToImage(blob);

        const canvas = activeDocument.createElement('canvas');
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        const ctx = canvas.getContext('2d')!;
        ctx.drawImage(img, 0, 0);

        // PNG 不支持质量参数，转为 webp 以获得更好的压缩
        const outputMime = ext === 'png' ? 'image/webp' : mimeType;
        const compressedBlob = await canvasToBlob(canvas, outputMime, qualityNorm);
        const compressedData = await compressedBlob.arrayBuffer();

        URL.revokeObjectURL(img.src);

        return {
            data: compressedData,
            originalSize: originalData.byteLength,
            optimizedSize: compressedData.byteLength,
            format: outputMime === 'image/webp' ? 'webp' : ext,
        };
    }

    /**
     * 转换图片格式
     */
    async convertFormat(file: TFile, targetFormat: 'webp' | 'jpg' | 'png'): Promise<OptimizeResult> {
        const originalData = await this.app.vault.readBinary(file);
        const ext = file.extension.toLowerCase();

        if (ext === 'svg') {
            throw new Error('SVG format conversion is not supported');
        }

        if (ext === targetFormat) {
            return { data: originalData, originalSize: originalData.byteLength, optimizedSize: originalData.byteLength, format: ext };
        }

        const mimeType = this.getMimeType(ext);
        const targetMime = this.getMimeType(targetFormat);

        const blob = new Blob([originalData], { type: mimeType });
        const img = await this.blobToImage(blob);

        const canvas = activeDocument.createElement('canvas');
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        const ctx = canvas.getContext('2d')!;
        ctx.drawImage(img, 0, 0);

        // JPG 不支持透明度，填充白色背景
        if (targetFormat === 'jpg') {
            const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const pixels = imageData.data;
            for (let i = 0; i < pixels.length; i += 4) {
                if (pixels[i + 3]! < 255) {
                    const alpha = pixels[i + 3]! / 255;
                    pixels[i] = Math.round(pixels[i]! * alpha + 255 * (1 - alpha));
                    pixels[i + 1] = Math.round(pixels[i + 1]! * alpha + 255 * (1 - alpha));
                    pixels[i + 2] = Math.round(pixels[i + 2]! * alpha + 255 * (1 - alpha));
                    pixels[i + 3] = 255;
                }
            }
            ctx.putImageData(imageData, 0, 0);
        }

        const compressedBlob = await canvasToBlob(canvas, targetMime, 0.92);
        const convertedData = await compressedBlob.arrayBuffer();

        URL.revokeObjectURL(img.src);

        return {
            data: convertedData,
            originalSize: originalData.byteLength,
            optimizedSize: convertedData.byteLength,
            format: targetFormat,
        };
    }

    /**
     * 获取图片信息（尺寸等）
     */
    async getImageInfo(file: TFile): Promise<{ width: number; height: number }> {
        const data = await this.app.vault.readBinary(file);
        const ext = file.extension.toLowerCase();
        const mimeType = this.getMimeType(ext);

        const blob = new Blob([data], { type: mimeType });
        const img = await this.blobToImage(blob);
        const info = { width: img.naturalWidth, height: img.naturalHeight };
        URL.revokeObjectURL(img.src);
        return info;
    }

    private blobToImage(blob: Blob): Promise<HTMLImageElement> {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => resolve(img);
            img.onerror = () => reject(new Error('Failed to load image'));
            img.src = URL.createObjectURL(blob);
        });
    }

    private getMimeType(ext: string): string {
        const map: Record<string, string> = {
            png: 'image/png',
            jpg: 'image/jpeg',
            jpeg: 'image/jpeg',
            gif: 'image/gif',
            bmp: 'image/bmp',
            webp: 'image/webp',
            tiff: 'image/tiff',
            tif: 'image/tiff',
            avif: 'image/avif',
            ico: 'image/x-icon',
        };
        return map[ext] ?? 'application/octet-stream';
    }
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob> {
    return new Promise((resolve, reject) => {
        canvas.toBlob(
            (blob) => {
                if (blob) resolve(blob);
                else reject(new Error('Canvas toBlob failed'));
            },
            type,
            quality
        );
    });
}
