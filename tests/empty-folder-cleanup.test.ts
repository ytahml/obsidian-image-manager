import { describe, expect, it, vi } from 'vitest';

vi.mock('obsidian', () => {
    class TFolder {
        path: string;
        children: unknown[] = [];
        private root: boolean;

        constructor(path = '', root = false) {
            this.path = path;
            this.root = root;
        }

        isRoot() {
            return this.root;
        }
    }

    return {
        normalizePath: (path: string) => path.replace(/^\/+|\/+$/g, '').replace(/\/+/g, '/'),
        TFolder,
    };
});

import { TFolder, type Vault } from 'obsidian';
import { removeEmptyDirectParent } from '../src/utils/empty-folder-cleanup';

function createFolder(path: string, root = false): TFolder {
    const folder = new TFolder();
    folder.path = path;
    if (root) vi.spyOn(folder, 'isRoot').mockReturnValue(true);
    return folder;
}

function createVault(current: TFolder | null, rmdir = vi.fn().mockResolvedValue(undefined)): Vault {
    return {
        getAbstractFileByPath: vi.fn().mockReturnValue(current),
        adapter: { rmdir },
    } as unknown as Vault;
}

describe('empty attachment folder cleanup', () => {
    it('permanently removes the exact empty direct parent without recursion', async () => {
        const folder = createFolder('notes/attachments');
        const rmdir = vi.fn().mockResolvedValue(undefined);

        await expect(removeEmptyDirectParent(createVault(folder, rmdir), folder)).resolves.toBe(true);
        expect(rmdir).toHaveBeenCalledWith('notes/attachments', false);
    });

    it('does not remove the vault root', async () => {
        const root = createFolder('', true);
        const rmdir = vi.fn().mockResolvedValue(undefined);
        const vault = createVault(root, rmdir);

        await expect(removeEmptyDirectParent(vault, root)).resolves.toBe(false);
        expect(rmdir).not.toHaveBeenCalled();
    });

    it('does not remove a non-empty folder', async () => {
        const folder = createFolder('attachments');
        folder.children.push(createFolder('attachments/nested'));
        const rmdir = vi.fn().mockResolvedValue(undefined);
        const vault = createVault(folder, rmdir);

        await expect(removeEmptyDirectParent(vault, folder)).resolves.toBe(false);
        expect(rmdir).not.toHaveBeenCalled();
    });

    it('does not remove a folder when the path now resolves to another object', async () => {
        const original = createFolder('attachments');
        const replacement = createFolder('attachments');
        const rmdir = vi.fn().mockResolvedValue(undefined);
        const vault = createVault(replacement, rmdir);

        await expect(removeEmptyDirectParent(vault, original)).resolves.toBe(false);
        expect(rmdir).not.toHaveBeenCalled();
    });

    it('does not remove a folder that has already disappeared', async () => {
        const folder = createFolder('attachments');
        const rmdir = vi.fn().mockResolvedValue(undefined);
        const vault = createVault(null, rmdir);

        await expect(removeEmptyDirectParent(vault, folder)).resolves.toBe(false);
        expect(rmdir).not.toHaveBeenCalled();
    });

    it('contains cleanup failures and leaves the upload flow successful', async () => {
        const folder = createFolder('attachments');
        const error = new Error('Directory changed');
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

        await expect(removeEmptyDirectParent(createVault(folder, vi.fn().mockRejectedValue(error)), folder)).resolves.toBe(false);
        expect(warn).toHaveBeenCalledWith(
            '[ImageManager] Failed to remove empty attachment folder attachments:',
            error
        );
        warn.mockRestore();
    });
});
