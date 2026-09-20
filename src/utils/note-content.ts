import { MarkdownView } from "obsidian";
import type { App, TFile } from "obsidian";

/** Read the live editor for the selected active note, otherwise read the saved file. */
export async function readNoteContentForAction(
    app: App,
    file: TFile,
): Promise<string> {
    const activeView = app.workspace.getActiveViewOfType(MarkdownView);
    if (activeView?.file?.path === file.path)
        return activeView.editor.getValue();
    return app.vault.read(file);
}

/** Snapshot every open Markdown editor through public workspace state for a conservative orphan scan. */
export function collectOpenMarkdownContentOverrides(
    app: App,
): Map<string, string> {
    const overrides = new Map<string, string>();
    const leaves = app.workspace?.getLeavesOfType?.("markdown") ?? [];
    for (const leaf of leaves) {
        const view = leaf.view;
        if (!(view instanceof MarkdownView) || !view.file) continue;
        overrides.set(view.file.path, view.editor.getValue());
    }
    return overrides;
}
