import { MarkdownView, type App, type Editor, type TFile } from 'obsidian';
import type { ImageManagerSettings } from '../types';
import { scanLocalOrphans } from '../utils/local-orphan-management';
import { isUploadSourceCurrent, type UploadSource } from './upload-scope';

export interface LocalCopyPolicy {
    mode: ImageManagerSettings['localManagementMode'];
    keepLocalCopy: boolean;
}
export interface LocalCopyResult { trashed: number; retained: number; failed: number }
export function getLocalCopyPolicy(settings: ImageManagerSettings): LocalCopyPolicy {
    const mode = settings.localManagementMode;
    return { mode, keepLocalCopy: mode === 'delegated' ? settings.delegatedKeepLocalCopy : settings.managedKeepLocalCopy };
}

interface EditorState { file: TFile; content: string }

/** Only explicit-upload sources may be recycled; no directories or remote objects are deleted. */
export class UploadLocalCleanup {
    constructor(
        private readonly app: App,
        private readonly getSettings: () => ImageManagerSettings,
        private readonly getIndeterminatePaths: () => ReadonlySet<string>,
    ) {}

    capturePolicy(): LocalCopyPolicy { return getLocalCopyPolicy(this.getSettings()); }

    async run(sources: readonly UploadSource[], eligiblePaths: ReadonlySet<string>, policy: LocalCopyPolicy): Promise<LocalCopyResult> {
        const result: LocalCopyResult = { trashed: 0, retained: sources.length, failed: 0 };
        for (const source of sources) {
            if (!eligiblePaths.has(source.path) || !this.mayRemove(source, policy)) continue;
            try {
                const first = await this.scan();
                if (!first.current() || !first.orphans.includes(source.file) || !this.mayRemove(source, policy)) continue;
                const fresh = await this.scan();
                // No async gap between final guards and the host's recoverable trash operation.
                if (!fresh.current() || !fresh.orphans.includes(source.file) || !this.mayRemove(source, policy)) continue;
                await this.app.fileManager.trashFile(source.file);
                result.trashed++;
                result.retained--;
            } catch {
                // A scan/read/trash failure cannot turn an upload success into an upload failure.
                result.failed++;
            }
        }
        return result;
    }

    private mayRemove(source: UploadSource, policy: LocalCopyPolicy): boolean {
        const current = this.capturePolicy();
        return !policy.keepLocalCopy && !current.keepLocalCopy && current.mode === policy.mode &&
            isUploadSourceCurrent(this.app, source) && !this.getIndeterminatePaths().has(source.path);
    }

    private editors(): Map<Editor, EditorState> {
        const views = this.app.workspace.getLeavesOfType('markdown').map(leaf => leaf.view);
        const active = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (active) views.push(active);
        const editors = new Map<Editor, EditorState>();
        const contents = new Map<TFile, string>();
        for (const view of views) {
            if (!(view instanceof MarkdownView) || !view.file) continue;
            const content = view.editor.getValue();
            if (contents.has(view.file) && contents.get(view.file) !== content) throw new Error('Conflicting editors');
            contents.set(view.file, content);
            editors.set(view.editor, { file: view.file, content });
        }
        return editors;
    }

    private async scan(): Promise<{ orphans: TFile[]; current: () => boolean }> {
        const files = this.app.vault.getFiles().map(file => ({ file, path: file.path, mtime: file.stat.mtime, size: file.stat.size }));
        const editors = this.editors();
        const overrides = new Map(Array.from(editors.values(), state => [state.file.path, state.content]));
        const result = await scanLocalOrphans(this.app, this.getSettings().supportedExtensions, overrides, this.getIndeterminatePaths());
        return { orphans: result.orphans, current: () => {
            if (this.app.vault.getFiles().length !== files.length || files.some(file => !isUploadSourceCurrent(this.app, file))) return false;
            const latest = this.editors();
            return latest.size === editors.size && Array.from(editors).every(([editor, state]) => {
                const now = latest.get(editor);
                return now?.file === state.file && now.content === state.content;
            });
        } };
    }
}
