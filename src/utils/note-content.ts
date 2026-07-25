import { MarkdownView } from 'obsidian';
import type { App, TFile } from 'obsidian';

/** Read the live editor for the selected active note, otherwise read the saved file. */
export async function readNoteContentForAction(app: App, file: TFile): Promise<string> {
    const activeView = app.workspace.getActiveViewOfType(MarkdownView);
    if (activeView?.file?.path === file.path) return activeView.editor.getValue();
    return app.vault.read(file);
}
