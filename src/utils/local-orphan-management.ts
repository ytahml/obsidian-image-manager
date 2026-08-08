import { TFile, type App } from 'obsidian';
import { OrphanFinder, type OrphanResult } from './orphan-finder';

export type LocalReferenceState = 'scanning' | 'referenced' | 'orphan' | 'unknown';
export type LocalReferenceFilter = 'all' | 'referenced' | 'orphan';

export interface ValidatedLocalOrphanSelection {
    eligible: TFile[];
    skippedPaths: string[];
}

export interface LocalOrphanDeleteResult {
    deletedPaths: string[];
    skippedPaths: string[];
    failedPaths: string[];
}

export type LocalOrphanScanner = () => Promise<OrphanResult>;

export function getLocalReferenceState(
    path: string,
    orphanPaths: Set<string> | null,
    scanState: 'scanning' | 'ready' | 'failed',
    indeterminatePaths: ReadonlySet<string> = new Set()
): LocalReferenceState {
    if (scanState === 'scanning') return 'scanning';
    if (scanState === 'failed' || !orphanPaths) return 'unknown';
    if (indeterminatePaths.has(path)) return 'unknown';
    return orphanPaths.has(path) ? 'orphan' : 'referenced';
}

export function filterLocalImagesByReferenceState<T extends { path: string }>(
    images: readonly T[],
    orphanPaths: ReadonlySet<string>,
    filter: LocalReferenceFilter,
    indeterminatePaths: ReadonlySet<string> = new Set()
): T[] {
    if (filter === 'all') return [...images];
    return images.filter((image) => {
        if (indeterminatePaths.has(image.path)) return false;
        const orphan = orphanPaths.has(image.path);
        return filter === 'orphan' ? orphan : !orphan;
    });
}

export function validateLocalOrphanSelection(
    selectedPaths: ReadonlySet<string>,
    result: OrphanResult
): ValidatedLocalOrphanSelection {
    const currentOrphans = new Map(result.orphans.map((file) => [file.path, file]));
    const eligible: TFile[] = [];
    const skippedPaths: string[] = [];

    for (const path of selectedPaths) {
        const file = currentOrphans.get(path);
        if (file) eligible.push(file);
        else skippedPaths.push(path);
    }

    return { eligible, skippedPaths };
}

export function scanLocalOrphans(
    app: App,
    supportedExtensions: string[],
    contentOverrides: ReadonlyMap<string, string> = new Map(),
    indeterminatePaths: ReadonlySet<string> = new Set()
): Promise<OrphanResult> {
    return new OrphanFinder(app, supportedExtensions).findOrphans(contentOverrides).then((result) => {
        const supported = new Set(supportedExtensions.map((extension) => extension.toLowerCase()));
        const indeterminate = Array.from(indeterminatePaths)
            .map((path) => app.vault.getAbstractFileByPath(path))
            .filter((file): file is TFile => file instanceof TFile && supported.has(file.extension.toLowerCase()));
        const orphanPaths = new Set(result.orphans.map((file) => file.path));
        const protectedReferenced = indeterminate.filter((file) => !orphanPaths.has(file.path)).length;
        return {
            ...result,
            orphans: result.orphans.filter((file) => !indeterminatePaths.has(file.path)),
            indeterminate,
            referenced: Math.max(0, result.referenced - protectedReferenced),
        };
    });
}

export async function trashValidatedLocalOrphans(
    app: App,
    selectedPaths: ReadonlySet<string>,
    scan: LocalOrphanScanner
): Promise<LocalOrphanDeleteResult> {
    const validation = validateLocalOrphanSelection(selectedPaths, await scan());
    const deletedPaths: string[] = [];
    const failedPaths: string[] = [];

    for (const file of validation.eligible) {
        try {
            await app.fileManager.trashFile(file);
            deletedPaths.push(file.path);
        } catch (error) {
            failedPaths.push(file.path);
            console.error(`[ImageManager] Failed to trash orphan image ${file.path}:`, error);
        }
    }

    return {
        deletedPaths,
        skippedPaths: validation.skippedPaths,
        failedPaths,
    };
}
