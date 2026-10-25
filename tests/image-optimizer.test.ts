import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('obsidian', () => ({ TFile: class TFile {} }));
import { TFile, type App } from 'obsidian';
import { ImageOptimizer } from '../src/utils/image-optimizer';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('ImageOptimizer output format', () => {
    it.each([
        ['png', false, 'image/webp', 'image/webp', 'webp'],
        ['png', true, 'image/png', 'image/png', 'png'],
        ['gif', false, 'image/gif', 'image/png', 'png'],
        ['gif', true, 'image/gif', 'image/png', 'gif'],
        ['jpg', false, 'image/jpeg', 'image/jpeg', 'jpg'],
        ['jpeg', true, 'image/jpeg', 'image/jpeg', 'jpeg'],
    ])('%s preserve=%s reports actual encoding or keeps original bytes', async (extension, preserve, requestedMime, actualMime, format) => {
        const original = new Uint8Array([1, 2, 3, 4]).buffer;
        const app = { vault: { readBinary: async () => original } } as unknown as App;
        const optimizer = new ImageOptimizer(app);
        vi.spyOn(optimizer as unknown as { blobToImage: () => Promise<HTMLImageElement> }, 'blobToImage')
            .mockResolvedValue({ naturalWidth: 1, naturalHeight: 1, src: 'blob:test' } as HTMLImageElement);
        const toBlob = vi.fn((callback: (blob: Blob) => void) => callback(new Blob([new Uint8Array([7, 8])], { type: actualMime })));
        vi.stubGlobal('createEl', () => ({ getContext: () => ({ drawImage: vi.fn() }), toBlob }));
        const result = await optimizer.compressImage(Object.assign(new TFile(), { extension }), 80, preserve);
        expect(toBlob).toHaveBeenCalledWith(expect.any(Function), requestedMime, 0.8);
        expect(result.format).toBe(format);
        expect(result.data).toEqual(preserve && actualMime !== requestedMime ? original : new Uint8Array([7, 8]).buffer);
    });
});
