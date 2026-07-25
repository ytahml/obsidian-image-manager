import { describe, expect, it, vi } from 'vitest';

vi.mock('obsidian', () => ({
    MarkdownView: class MarkdownView {},
    TFile: class TFile {},
}));

import { TFile, type App } from 'obsidian';
import { readNoteContentForAction } from '../src/utils/note-content';

describe('readNoteContentForAction', () => {
    it('uses live editor text when the selected note is active', async () => {
        const read = vi.fn();
        const app = {
            workspace: {
                getActiveViewOfType: vi.fn(() => ({
                    file: { path: 'notes/current.md' },
                    editor: { getValue: () => '![live](image.png)' },
                })),
            },
            vault: { read },
        } as unknown as App;
        const file = new TFile();
        file.path = 'notes/current.md';

        await expect(readNoteContentForAction(app, file)).resolves.toBe('![live](image.png)');
        expect(read).not.toHaveBeenCalled();
    });

    it('reads the saved file when the selected note is not active', async () => {
        const read = vi.fn(async () => '![saved](image.png)');
        const app = {
            workspace: {
                getActiveViewOfType: vi.fn(() => ({
                    file: { path: 'notes/other.md' },
                    editor: { getValue: () => '![other](image.png)' },
                })),
            },
            vault: { read },
        } as unknown as App;
        const file = new TFile();
        file.path = 'notes/current.md';

        await expect(readNoteContentForAction(app, file)).resolves.toBe('![saved](image.png)');
        expect(read).toHaveBeenCalledWith(file);
    });
});
