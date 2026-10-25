import { MarkdownView } from 'obsidian';
import type { App, Editor, TFile } from 'obsidian';

export interface NoteContentSnapshot {
    path: string;
    content: string;
    editors: Editor[];
}

function markdownViews(app: App): MarkdownView[] {
    const views = new Set<MarkdownView>();
    for (const leaf of app.workspace.getLeavesOfType?.('markdown') ?? []) {
        const view = leaf.view;
        if (view instanceof MarkdownView) views.add(view);
    }
    const active = app.workspace.getActiveViewOfType(MarkdownView);
    if (active) views.add(active);
    return Array.from(views);
}

function noteEditors(app: App, file: TFile): Editor[] {
    return Array.from(new Set(markdownViews(app).filter(view => view.file === file).map(view => view.editor)));
}

/** A reused Editor must still belong to the original, existing note before an async effect. */
export function isEditorBoundToFile(app: App, editor: Editor, file: TFile | null): file is TFile {
    return file !== null && app.vault.getAbstractFileByPath(file.path) === file && noteEditors(app, file).includes(editor);
}

/** Synchronous guard for unsaved content and editor open/close/rebind changes. */
export function captureMarkdownEditorState(app: App): () => boolean {
    const capture = () => new Map(markdownViews(app)
        .filter((view): view is MarkdownView & { file: TFile } => view.file !== null)
        .map(view => [view.editor, { file: view.file, path: view.file.path, content: view.editor.getValue() }]));
    const initial = capture();
    return () => {
        const current = capture();
        return current.size === initial.size && Array.from(initial).every(([editor, state]) => {
            const latest = current.get(editor);
            return latest?.file === state.file && latest.path === state.path && latest.content === state.content &&
                app.vault.getAbstractFileByPath(state.path) === state.file;
        });
    };
}

/** All open views must agree; never read saved content behind an open editor. */
export async function readNoteSnapshot(app: App, file: TFile): Promise<NoteContentSnapshot> {
    const editors = noteEditors(app, file);
    const content = editors.length ? editors[0]!.getValue() : await app.vault.read(file);
    if (editors.some(editor => editor.getValue() !== content)) throw new Error('Conflicting editors');
    return { path: file.path, content, editors };
}

export async function readNoteContentForAction(app: App, file: TFile): Promise<string> {
    return (await readNoteSnapshot(app, file)).content;
}

/** Revalidate binding and contents immediately before mutation. No asynchronous gap for editors. */
export async function writeNoteSnapshot(
    app: App, file: TFile, snapshot: NoteContentSnapshot, content: string,
    validate: () => boolean = () => true,
): Promise<'applied' | 'unchanged' | 'conflict'> {
    if (file.path !== snapshot.path || app.vault.getAbstractFileByPath(snapshot.path) !== file || !validate()) return 'conflict';
    const editors = noteEditors(app, file);
    if (editors.length !== snapshot.editors.length || editors.some(editor => !snapshot.editors.includes(editor))) return 'conflict';
    if (editors.length) {
        if (editors.some(editor => editor.getValue() !== snapshot.content)) return 'conflict';
        if (content === snapshot.content) return 'unchanged';
        for (const editor of editors) {
            // Different views can share a document; it may already reflect our write.
            if (editor.getValue() === content) continue;
            editor.replaceRange(content, { line: 0, ch: 0 }, editor.offsetToPos(snapshot.content.length));
        }
        return 'applied';
    }
    let result: 'applied' | 'unchanged' | 'conflict' = 'conflict';
    await app.vault.process(file, current => {
        if (current !== snapshot.content || noteEditors(app, file).length || file.path !== snapshot.path ||
            app.vault.getAbstractFileByPath(snapshot.path) !== file || !validate()) return current;
        result = content === current ? 'unchanged' : 'applied';
        return content;
    });
    return result;
}

/** Snapshot every open Markdown editor through public workspace state for a conservative orphan scan. */
export function collectOpenMarkdownContentOverrides(app: App): Map<string, string> {
    const overrides = new Map<string, string>();
    for (const leaf of app.workspace?.getLeavesOfType?.('markdown') ?? []) {
        const view = leaf.view;
        if (view instanceof MarkdownView && view.file) overrides.set(view.file.path, view.editor.getValue());
    }
    return overrides;
}
