import { describe, expect, it, vi } from 'vitest';
vi.mock('obsidian', () => ({ TFile: class TFile {} }));
import { TFile } from 'obsidian';
import type { ImageHostingConfig } from '../src/types';
import { UploadQueue } from '../src/uploaders/upload-queue';
import type { UploadService, UploadServiceOptions } from '../src/uploaders/upload-service';

it('retains exact source identity and failures despite repeated provider filenames', async () => {
    const files = ['one/x.png', 'two/x.png'].map(path => Object.assign(new TFile(), { path, name: 'x.png', stat: { mtime: 1, size: 1 } }));
    const uploadFile = vi.fn(async (file: TFile) => ({ success: file === files[0], originalPath: 'x.png', url: file === files[0] ? 'https://cdn/x.png' : undefined, error: 'failed', attempts: 1, hostingId: 'h', hostingType: 'custom' }));
    const queue = new UploadQueue({ uploadFile } as unknown as UploadService);
    queue.addFiles(files);
    const results = await queue.startItems({ id: 'h', type: 'custom' } as ImageHostingConfig);
    expect(results).toHaveLength(2);
    expect(uploadFile.mock.calls.map(call => call[0].path)).toEqual(['one/x.png', 'two/x.png']);
    expect(results[0]!.source.file).toBe(files[0]);
    expect(results[1]!.source.path).toBe('two/x.png');
    expect(results[1]!.operation.success).toBe(false);
    expect(queue.getProgress()).toMatchObject({ total: 2, completed: 2, failed: 1 });
});
describe('queue validation', () => {
    it('bounds concurrency at three, preserves source order despite completion order, and sets the retry limit', async () => {
        const files = Array.from({ length: 5 }, (_, i) => Object.assign(new TFile(), { path: `${i}.png`, name: `${i}.png`, stat: { mtime: 1, size: 1 } }));
        const releases = new Map<string, () => void>();
        let active = 0, peak = 0;
        const uploadFile = vi.fn(async (file: TFile, _hosting: ImageHostingConfig, options: UploadServiceOptions) => {
            expect(options.maxRetries).toBe(3);
            active++; peak = Math.max(peak, active);
            await new Promise<void>(resolve => releases.set(file.path, resolve));
            active--;
            return { success: true, originalPath: 'untrusted.png', url: `https://cdn/${file.path}`, attempts: 1, hostingId: 'h', hostingType: 'custom' as const };
        });
        const queue = new UploadQueue({ uploadFile } as unknown as UploadService);
        queue.addFiles(files);
        const result = queue.startItems({ id: 'h', type: 'custom' } as ImageHostingConfig);
        expect(uploadFile).toHaveBeenCalledTimes(3);
        releases.get('2.png')!();
        await vi.waitFor(() => expect(uploadFile).toHaveBeenCalledTimes(4));
        releases.get('1.png')!();
        await vi.waitFor(() => expect(uploadFile).toHaveBeenCalledTimes(5));
        for (const release of releases.values()) release();
        expect((await result).map(item => item.source.path)).toEqual(files.map(file => file.path));
        expect(peak).toBe(3);
    });
    it('does not send a request for a changed source', async () => {
        const uploadFile = vi.fn();
        const queue = new UploadQueue({ uploadFile } as unknown as UploadService);
        queue.addFiles([Object.assign(new TFile(), { path: 'a.png', name: 'a.png', stat: { mtime: 1, size: 1 } })]);
        const results = await queue.startItems({ id: 'h', type: 'custom' } as ImageHostingConfig, {}, () => false);
        expect(uploadFile).not.toHaveBeenCalled();
        expect(results[0]!.operation.cancelled).toBe(true);
    });
});
