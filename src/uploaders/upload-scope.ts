import type { App, TFile } from 'obsidian';
import type { RefConverter } from '../utils/ref-converter';
import { createLocalFileLookup, resolveLocalFileReference } from '../utils/local-image-resolution';
import { readNoteContentForAction } from '../utils/note-content';
import { getNotesInScope, type NoteScope } from '../utils/note-scope';

export type UploadScope = NoteScope;
export interface UploadSource {
    file: TFile;
    path: string;
    mtime: number;
    size: number;
}
export interface UploadPlan {
    scope: UploadScope;
    notes: TFile[];
    sources: UploadSource[];
    skipped: Array<{ notePath: string; reference: string; reason: 'missing' | 'ambiguous' | 'unsupported' | 'read-failed' }>;
}
export function snapshotUploadSource(file: TFile): UploadSource {
    return { file, path: file.path, mtime: file.stat.mtime, size: file.stat.size };
}
export function isUploadSourceCurrent(app: App, source: UploadSource): boolean {
    return app.vault.getAbstractFileByPath(source.path) === source.file &&
        source.file.path === source.path && source.file.stat.mtime === source.mtime &&
        source.file.stat.size === source.size;
}

/** Scope selects notes, never the attachment directories. No network or mutation. */
export async function createUploadPlan(
    app: App, converter: RefConverter, scope: UploadScope, extensions: readonly string[],
): Promise<UploadPlan> {
    const notes = getNotesInScope(app, scope);
    const plan: UploadPlan = { scope, notes, sources: [], skipped: [] };
    const lookup = createLocalFileLookup(app.vault.getFiles());
    const seen = new Set<string>();
    const supported = new Set(extensions.map(ext => ext.toLowerCase()));
    for (const note of notes) {
        let content: string;
        try { content = await readNoteContentForAction(app, note); }
        catch { plan.skipped.push({ notePath: note.path, reference: '', reason: 'read-failed' }); continue; }
        for (const ref of converter.parseReferences(content)) {
            const resolution = resolveLocalFileReference(app, note, ref.path, ref.format, lookup);
            if (resolution.status === 'remote') continue;
            if (resolution.status !== 'resolved') {
                plan.skipped.push({ notePath: note.path, reference: ref.path, reason: resolution.status === 'ambiguous' ? 'ambiguous' : 'missing' });
                continue;
            }
            const file = resolution.file;
            if (!supported.has(file.extension.toLowerCase())) {
                plan.skipped.push({ notePath: note.path, reference: ref.path, reason: 'unsupported' });
                continue;
            }
            if (!seen.has(file.path)) {
                seen.add(file.path);
                plan.sources.push(snapshotUploadSource(file));
            }
        }
    }
    return plan;
}
