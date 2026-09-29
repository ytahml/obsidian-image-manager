import type { App, TFile } from 'obsidian';

export type NoteScope = { kind: 'vault' } | { kind: 'folder' | 'note'; path: string };

/** Select Markdown notes by note location, never by attachment location. */
export function getNotesInScope(app: App, scope: NoteScope): TFile[] {
    const folder = scope.kind === 'folder' ? scope.path.replace(/^\/+|\/+$/g, '') : '';
    return app.vault.getMarkdownFiles().filter(note =>
        scope.kind === 'vault' || (scope.kind === 'note' ? note.path === scope.path :
            folder === '' || note.path.startsWith(`${folder}/`)));
}
