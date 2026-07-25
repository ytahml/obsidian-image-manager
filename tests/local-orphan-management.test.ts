import { describe, expect, it, vi } from 'vitest';

vi.mock('obsidian', () => ({
    TFile: class TFile {},
}));

import { TFile, type App } from 'obsidian';
import type { OrphanResult } from '../src/utils/orphan-finder';
import {
    getLocalReferenceState,
    trashValidatedLocalOrphans,
    validateLocalOrphanSelection,
} from '../src/utils/local-orphan-management';

function image(path: string, size = 10): TFile {
    const file = new TFile();
    file.path = path;
    file.stat = { size, ctime: 0, mtime: 0 };
    return file;
}

function result(orphans: TFile[]): OrphanResult {
    return { orphans, total: orphans.length, referenced: 0 };
}

describe('local orphan management', () => {
    it('maps scan lifecycle and orphan membership to conservative card states', () => {
        const paths = new Set(['orphan.png']);
        expect(getLocalReferenceState('orphan.png', null, 'scanning')).toBe('scanning');
        expect(getLocalReferenceState('orphan.png', null, 'failed')).toBe('unknown');
        expect(getLocalReferenceState('orphan.png', paths, 'ready')).toBe('orphan');
        expect(getLocalReferenceState('referenced.png', paths, 'ready')).toBe('referenced');
    });

    it('only validates files that remain orphaned in the fresh result', () => {
        const current = image('current.png');
        expect(validateLocalOrphanSelection(
            new Set(['current.png', 'now-referenced.png', 'missing.png']),
            result([current])
        )).toEqual({
            eligible: [current],
            skippedPaths: ['now-referenced.png', 'missing.png'],
        });
    });

    it('rescans before trashing and reports deleted, skipped, and failed paths', async () => {
        const deleted = image('deleted.png');
        const failed = image('failed.png');
        const error = new Error('Trash failed');
        const trashFile = vi.fn(async (file: TFile) => {
            if (file.path === failed.path) throw error;
        });
        const warn = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        const app = { fileManager: { trashFile } } as unknown as App;

        await expect(trashValidatedLocalOrphans(
            app,
            new Set(['deleted.png', 'failed.png', 'now-referenced.png']),
            vi.fn().mockResolvedValue(result([deleted, failed]))
        )).resolves.toEqual({
            deletedPaths: ['deleted.png'],
            skippedPaths: ['now-referenced.png'],
            failedPaths: ['failed.png'],
        });
        expect(trashFile).toHaveBeenCalledTimes(2);
        expect(warn).toHaveBeenCalledWith(
            '[ImageManager] Failed to trash orphan image failed.png:',
            error
        );
        warn.mockRestore();
    });
});
