import { describe, expect, it, vi } from 'vitest';

const { findOrphans } = vi.hoisted(() => ({ findOrphans: vi.fn() }));

vi.mock('obsidian', () => ({ TFile: class TFile {} }));
vi.mock('../src/utils/orphan-finder', () => ({
    OrphanFinder: class OrphanFinder { findOrphans = findOrphans; },
}));

import { TFile, type App } from 'obsidian';
import { scanLocalOrphans } from '../src/utils/local-orphan-management';

function image(path: string): TFile {
    const target = new TFile();
    target.path = path;
    target.extension = 'png';
    return target;
}

describe('scanLocalOrphans indeterminate protection', () => {
    it('marks both referenced and orphaned protected images as indeterminate', async () => {
        const orphan = image('orphan.png');
        const referenced = image('referenced.png');
        const files = new Map([[orphan.path, orphan], [referenced.path, referenced]]);
        findOrphans.mockResolvedValue({ orphans: [orphan], indeterminate: [], total: 2, referenced: 1 });
        const app = {
            vault: { getAbstractFileByPath: (path: string) => files.get(path) ?? null },
        } as unknown as App;

        await expect(scanLocalOrphans(
            app,
            ['png'],
            new Map(),
            new Set([orphan.path, referenced.path])
        )).resolves.toEqual({
            orphans: [],
            indeterminate: [orphan, referenced],
            total: 2,
            referenced: 0,
        });
    });
});
