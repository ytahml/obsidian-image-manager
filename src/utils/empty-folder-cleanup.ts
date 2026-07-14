import { normalizePath, TFolder, type Vault } from 'obsidian';

export async function removeEmptyDirectParent(vault: Vault, folder: TFolder | null): Promise<boolean> {
    if (!folder || folder.isRoot()) return false;

    const current = vault.getAbstractFileByPath(folder.path);
    if (current !== folder || !(current instanceof TFolder) || current.children.length > 0) {
        return false;
    }

    try {
        await vault.adapter.rmdir(normalizePath(current.path), false);
        return true;
    } catch (error) {
        console.warn(`[ImageManager] Failed to remove empty attachment folder ${current.path}:`, error);
        return false;
    }
}
