import { TFile, TFolder, type TAbstractFile } from 'obsidian';
import type { NoteScope } from './utils/note-scope';

export interface ImageFileMenuActions {
    upload: (scope: NoteScope) => void;
    convert: (scope: NoteScope) => void | Promise<void>;
    reorganizeNote: (file: TFile) => void | Promise<void>;
    reorganizeFolder: (path: string) => void | Promise<void>;
}

export interface ImageFileMenuItem {
    titleKey: 'command.batchUpload' | 'command.reorganizeImages' | 'command.convertReference';
    icon: 'upload' | 'image-file' | 'file-text';
    run: () => void;
}

/** Builds target-bound menu actions without consulting the active note. */
export function createImageFileMenuItems(file: TAbstractFile, actions: ImageFileMenuActions): ImageFileMenuItem[] {
    if (file instanceof TFolder) {
        const scope: NoteScope = { kind: 'folder', path: file.path };
        return [
            { titleKey: 'command.batchUpload', icon: 'upload', run: () => actions.upload(scope) },
            { titleKey: 'command.reorganizeImages', icon: 'image-file', run: () => { void actions.reorganizeFolder(file.path); } },
            { titleKey: 'command.convertReference', icon: 'file-text', run: () => { void actions.convert(scope); } },
        ];
    }
    if (file instanceof TFile && file.extension === 'md') {
        const scope: NoteScope = { kind: 'note', path: file.path };
        return [
            { titleKey: 'command.batchUpload', icon: 'upload', run: () => actions.upload(scope) },
            { titleKey: 'command.reorganizeImages', icon: 'image-file', run: () => { void actions.reorganizeNote(file); } },
            { titleKey: 'command.convertReference', icon: 'file-text', run: () => { void actions.convert(scope); } },
        ];
    }
    return [];
}
