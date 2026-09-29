import { expect, it, vi } from 'vitest';
vi.mock('obsidian', () => ({ TFile: class TFile {} }));
import { TFile } from 'obsidian';
import { createImageCommands, type ImageCommandActions } from '../src/commands.js';

function fixture() {
    let file: TFile | null = null;
    let enabled = true;
    const actions: ImageCommandActions = {
        getActiveFile: () => file, isImage: value => value.extension === 'png', browserEnabled: () => enabled,
        browse: vi.fn(), compress: vi.fn(), convertScope: vi.fn(), uploadImage: vi.fn(),
        uploadScope: vi.fn(), findOrphans: vi.fn(), rename: vi.fn(), reorganize: vi.fn(),
    };
    return { actions, commands: createImageCommands(actions), setFile: (value: TFile | null) => { file = value; }, disable: () => { enabled = false; } };
}
it('registers exactly the eight implemented IDs without legacy scope aliases', () => {
    const f = fixture();
    expect(f.commands.map(c => c.id).sort()).toEqual(['browse-images', 'compress-current-image', 'convert-reference-format', 'upload-to-hosting', 'batch-upload', 'find-orphan-images', 'rename-image', 'reorganize-images'].sort());
});
it('opens both unified scope commands without requiring an active file', () => {
    const f = fixture();
    f.commands.find(c => c.id === 'convert-reference-format')!.callback?.();
    f.commands.find(c => c.id === 'batch-upload')!.callback?.();
    expect(f.actions.convertScope).toHaveBeenCalledOnce();
    expect(f.actions.uploadScope).toHaveBeenCalledOnce();
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
