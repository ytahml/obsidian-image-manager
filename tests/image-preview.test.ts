import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

describe('local image preview references', () => {
    it('renders every referencing note expanded by default while keeping the collapse toggle', async () => {
        const sourcePath = fileURLToPath(new URL('../src/modals/image-preview-modal.ts', import.meta.url));
        const source = await readFile(sourcePath, 'utf8');

        expect(source).toContain("const notesList = infoEl.createDiv({ cls: 'image-preview-notes' });");
        expect(source).toContain('let expanded = true;');
        expect(source).toContain('for (const note of notes)');
        expect(source).not.toContain('notes.slice(0, 10)');
        expect(source).toContain("notesList.toggleClass('image-preview-notes-hidden', !expanded);");
    });
});
