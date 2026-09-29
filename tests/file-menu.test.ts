import { expect, it, vi } from 'vitest';
vi.mock('obsidian', () => ({ TFile: class TFile {}, TFolder: class TFolder {} }));
import { TFile, TFolder } from 'obsidian';
import { createImageFileMenuItems, type ImageFileMenuActions } from '../src/file-menu';

function actions(): ImageFileMenuActions {
    return { upload: vi.fn(), convert: vi.fn(), reorganizeNote: vi.fn(), reorganizeFolder: vi.fn() };
}

it('binds folder menu actions to the clicked recursive folder scope', () => {
    const target = Object.assign(new TFolder(), { path: 'notes/sub' });
    const handlers = actions();
    const items = createImageFileMenuItems(target, handlers);
    expect(items.map(item => item.titleKey)).toEqual(['command.batchUpload', 'command.reorganizeImages', 'command.convertReference']);
    items[0]!.run(); items[2]!.run();
    expect(handlers.upload).toHaveBeenCalledWith({ kind: 'folder', path: 'notes/sub' });
    expect(handlers.convert).toHaveBeenCalledWith({ kind: 'folder', path: 'notes/sub' });
});

it('binds note menu actions to the clicked note and ignores other files', () => {
    const target = Object.assign(new TFile(), { path: 'notes/a.md', extension: 'md' });
    const handlers = actions();
    const items = createImageFileMenuItems(target, handlers);
    items[0]!.run(); items[1]!.run(); items[2]!.run();
    expect(handlers.upload).toHaveBeenCalledWith({ kind: 'note', path: 'notes/a.md' });
    expect(handlers.reorganizeNote).toHaveBeenCalledWith(target);
    expect(handlers.convert).toHaveBeenCalledWith({ kind: 'note', path: 'notes/a.md' });
    expect(createImageFileMenuItems(Object.assign(new TFile(), { path: 'image.png', extension: 'png' }), handlers)).toEqual([]);
});
