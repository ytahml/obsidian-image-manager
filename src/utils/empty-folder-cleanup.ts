import { FileSystemAdapter, Platform, TFolder, type Vault } from 'obsidian';

/** Only the desktop filesystem exposes an atomic empty-directory removal. */
export async function removeEmptyFolders(vault: Vault, folders: readonly (TFolder | null)[]): Promise<void> {
    if (Platform.isDesktop && vault.adapter instanceof FileSystemAdapter) {
        const adapter = vault.adapter;
        const removed = new Set<TFolder>();
        const candidates = Array.from(new Set(folders.filter((f): f is TFolder => f !== null)))
            .map(folder => ({ folder, path: folder.path }))
            .sort((a, b) => b.path.split('/').length - a.path.split('/').length);

        try {
            const fs = await import('fs/promises');
            const path = await import('path');
            const base = await fs.realpath(adapter.getBasePath());
            for (const candidate of candidates) {
                const folder = candidate.folder;
                try {
                    if (folder.isRoot() || !candidate.path || candidate.path.split('/').some(p => !p || p === '.' || p === '..')) continue;
                    const target = path.resolve(base, candidate.path);
                    const relative = path.relative(base, target);
                    if (!relative || relative.startsWith('..' + path.sep) || relative === '..' || path.isAbsolute(relative)) continue;
                    // A vault may expose external folders through symbolic links.
                    if (await fs.realpath(target) !== target) continue;
                    if (vault.getAbstractFileByPath(candidate.path) !== folder ||
                        folder.children.some(child => !(child instanceof TFolder && removed.has(child)))) continue;

                    // Obsidian Desktop 1.14 uses fs.rm for adapter.rmdir(false), which rejects even empty folders.
                    // fs.rmdir refuses nonempty folders, including unindexed files or concurrent writes.
                    await fs.rmdir(target);
                    removed.add(folder); // The watcher may still list this child when we check its parent.
                } catch (error) {
                    const code = (error as { code?: string })?.code;
                    if (code !== 'ENOENT' && code !== 'ENOTEMPTY' && code !== 'EEXIST') {
                        console.warn('[ImageManager] Failed to remove empty attachment folder:', candidate.path, error);
                    }
                }
            }
        } catch (error) {
            console.warn('[ImageManager] Empty folder cleanup unavailable:', error);
        }
    }
}
