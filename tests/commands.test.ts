import { expect, it, vi } from 'vitest';
vi.mock('obsidian', () => ({ TFile: class TFile {} }));
import { TFile } from 'obsidian';
import { createImageCommands, type ImageCommandActions } from '../src/commands.js';

function fixture() {
    let file: TFile | null = null;
    let enabled = true;
    const actions: ImageCommandActions = {
        getActiveFile: () => file, isImage: value => value.extension === 'png', browserEnabled: () => enabled,
        browse: vi.fn(), compress: vi.fn(), convertNote: vi.fn(), convertVault: vi.fn(), uploadImage: vi.fn(),
        uploadNote: vi.fn(), uploadScope: vi.fn(), findOrphans: vi.fn(), rename: vi.fn(), reorganize: vi.fn(),
    };
    return { actions, commands: createImageCommands(actions), setFile: (value: TFile | null) => { file = value; }, disable: () => { enabled = false; } };
}
it('registers exactly the eleven implemented IDs, retaining both conversion aliases', () => {
    const f = fixture();
    expect(f.commands.map(c => c.id).sort()).toEqual(['browse-images', 'compress-current-image', 'convert-reference-format', 'convert-reference-format-vault', 'upload-to-hosting', 'upload-note-images', 'batch-upload', 'find-orphan-images', 'rename-image', 'reorganize-images', 'convert-to-md'].sort());
});
it('checks context without executing actions and routes both conversion commands to the same operation', () => {
    const f = fixture();
    const aliases = f.commands.filter(c => ['convert-to-md', 'convert-reference-format'].includes(c.id));
    for (const command of aliases) expect(command.checkCallback?.(true)).toBe(false);
    f.setFile(Object.assign(new TFile(), { path: 'a.md', extension: 'md' }));
    for (const command of aliases) expect(command.checkCallback?.(true)).toBe(true);
    expect(f.actions.convertNote).not.toHaveBeenCalled();
    for (const command of aliases) command.checkCallback?.(false);
    expect(f.actions.convertNote).toHaveBeenCalledTimes(2);
});
it('enforces image/browser gates and every registered command has an executable route', () => {
    const f = fixture();
    const imageCommand = f.commands.find(c => c.id === 'upload-to-hosting')!;
    expect(imageCommand.checkCallback?.(true)).toBe(false);
    f.setFile(Object.assign(new TFile(), { path: 'a.png', extension: 'png' }));
    expect(imageCommand.checkCallback?.(true)).toBe(true);
    imageCommand.checkCallback?.(false);
    expect(f.actions.uploadImage).toHaveBeenCalledOnce();
    f.disable();
    expect(f.commands.find(c => c.id === 'browse-images')!.checkCallback?.(false)).toBe(false);
    expect(f.actions.browse).not.toHaveBeenCalled();
    expect(f.commands.every(c => c.callback || c.checkCallback)).toBe(true);
});
