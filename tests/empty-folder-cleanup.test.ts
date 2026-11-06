import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { FileSystemAdapter, Platform, TFolder, type Vault } from 'obsidian';
import { removeEmptyFolders } from '../src/utils/empty-folder-cleanup';

vi.mock('obsidian', () => ({
    Platform: { isDesktop: true },
    FileSystemAdapter: class { getBasePath() { return '/vault'; } },
    TFolder: class { path = ''; children: TFolder[] = []; isRoot() { return this.path === '/'; } },
}));

const { rmdir, realpath } = vi.hoisted(() => ({ rmdir: vi.fn(), realpath: vi.fn() }));
vi.mock('fs/promises', () => ({ rmdir, realpath }));

function folder(path: string): TFolder {
    const f = new TFolder();
    f.path = path;
    return f;
}

function vault(folders: TFolder[], base = '/vault'): Vault {
    return {
        adapter: Object.assign(Object.create(FileSystemAdapter.prototype) as FileSystemAdapter, { getBasePath: () => base }),
        getAbstractFileByPath: (path: string) => folders.find(f => f.path === path),
    } as unknown as Vault;
}

let paths: typeof import('path');
beforeAll(async () => { paths = await vi.importActual<typeof import('path')>('path'); });
const inVault = (relative: string) => paths.resolve('/vault', relative);

describe('empty attachment folder cleanup', () => {
    beforeEach(() => {
        rmdir.mockReset().mockResolvedValue(undefined);
        realpath.mockReset().mockImplementation((path: string) => Promise.resolve(path));
    });
    afterEach(() => vi.restoreAllMocks());

    it('removes the child before its new parent, even while the vault still lists the removed child', async () => {
        const parent = folder('notes/assets');
        const child = folder('notes/assets/images');
        parent.children.push(child);
        await removeEmptyFolders(vault([parent, child]), [parent, child, child]);
        expect(rmdir.mock.calls).toEqual([[inVault('notes/assets/images')], [inVault('notes/assets')]]);
    });

    it('keeps root, replaced, missing, non-empty and escaping candidates', async () => {
        const root = folder('/');
        const original = folder('replaced');
        const occupied = folder('occupied');
        occupied.children.push(folder('occupied/other'));
        const escape = folder('../outside');
        const link = folder('linked');
        realpath.mockImplementation((p: string) => Promise.resolve(p === inVault('linked') ? '/external' : p));
        await removeEmptyFolders(vault([root, folder('replaced'), occupied, escape, link]),
            [null, root, original, folder('missing'), occupied, escape, link]);
        expect(rmdir).not.toHaveBeenCalled();
    });

    it('preserves the parent when the OS finds a child missing from the vault index', async () => {
        const parent = folder('assets');
        const child = folder('assets/images');
        parent.children.push(child);
        rmdir.mockRejectedValue(Object.assign(new Error('not empty'), { code: 'ENOTEMPTY' }));
        await removeEmptyFolders(vault([parent, child]), [parent, child]);
        expect(rmdir.mock.calls).toEqual([[inVault('assets/images')]]);
    });

    it('removes a real empty directory but preserves an unindexed file inside another one', async () => {
        const fs = await vi.importActual<typeof import('fs/promises')>('fs/promises');
        const os = await vi.importActual<typeof import('os')>('os');
        const base = await fs.mkdtemp(paths.join(os.tmpdir(), 'oim-empty-'));
        const empty = folder('empty');
        const occupied = folder('occupied');
        const directory = paths.join(base, occupied.path);
        const marker = paths.join(directory, '.keep');
        const emptyPath = paths.join(base, empty.path);
        await fs.mkdir(emptyPath);
        await fs.mkdir(directory);
        await fs.writeFile(marker, 'keep');
        try {
            realpath.mockImplementation(fs.realpath);
            rmdir.mockImplementation(fs.rmdir);
            await removeEmptyFolders(vault([empty, occupied], base), [empty, occupied]);
            expect(await fs.readdir(base)).toEqual(['occupied']);
            expect(await fs.readFile(marker, 'utf8')).toBe('keep');
        } finally {
            await fs.unlink(marker);
            await fs.rmdir(directory);
            if ((await fs.readdir(base)).includes('empty')) await fs.rmdir(emptyPath);
            await fs.rmdir(base);
        }
    });

    it('contains filesystem failures after the image was recycled', async () => {
        const f = folder('assets');
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        realpath.mockRejectedValue(new Error('unavailable'));
        await expect(removeEmptyFolders(vault([f]), [f])).resolves.toBeUndefined();
        expect(warn).toHaveBeenCalledOnce();
    });

    it('skips automatic directory deletion on mobile', async () => {
        const desktop = Platform.isDesktop;
        try {
            Platform.isDesktop = false;
            const f = folder('assets');
            await removeEmptyFolders(vault([f]), [f]);
            expect(realpath).not.toHaveBeenCalled();
            expect(rmdir).not.toHaveBeenCalled();
        } finally { Platform.isDesktop = desktop; }
    });
});
