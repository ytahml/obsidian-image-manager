import type { Command, TFile } from 'obsidian';
import { t } from './i18n';

type FileAction = (file: TFile) => void | Promise<void>;
export interface ImageCommandActions {
    getActiveFile: () => TFile | null;
    isImage: (file: TFile) => boolean;
    browserEnabled: () => boolean;
    browse: () => void;
    compress: FileAction;
    convertNote: FileAction;
    convertVault: () => void | Promise<void>;
    uploadImage: FileAction;
    uploadNote: FileAction;
    uploadScope: () => void;
    findOrphans: () => void;
    rename: FileAction;
    reorganize: FileAction;
}

/** Only implemented operations. Published aliases intentionally retain their IDs. */
export function createImageCommands(actions: ImageCommandActions): Command[] {
    const fileCommand = (id: string, key: string, eligible: (file: TFile) => boolean, run: FileAction): Command => ({
        id, name: t(key), checkCallback: checking => {
            const file = actions.getActiveFile();
            if (!file || !eligible(file)) return false;
            if (!checking) void run(file);
            return true;
        },
    });
    const markdown = (file: TFile) => file.extension === 'md';
    return [
        { id: 'browse-images', name: t('command.browseImages'), checkCallback: checking => {
            if (!actions.browserEnabled()) return false;
            if (!checking) actions.browse();
            return true;
        } },
        fileCommand('compress-current-image', 'command.compressImage', actions.isImage, actions.compress),
        fileCommand('convert-reference-format', 'command.convertReference', markdown, actions.convertNote),
        { id: 'convert-reference-format-vault', name: t('command.convertReferenceVault'), callback: () => { void actions.convertVault(); } },
        fileCommand('upload-to-hosting', 'command.uploadToHosting', actions.isImage, actions.uploadImage),
        fileCommand('upload-note-images', 'command.uploadNoteImages', markdown, actions.uploadNote),
        { id: 'batch-upload', name: t('command.batchUpload'), callback: actions.uploadScope },
        { id: 'find-orphan-images', name: t('command.findOrphans'), callback: actions.findOrphans },
        fileCommand('rename-image', 'command.renameImage', actions.isImage, actions.rename),
        fileCommand('reorganize-images', 'command.reorganizeImages', markdown, actions.reorganize),
        fileCommand('convert-to-md', 'command.convertToMd', markdown, actions.convertNote),
    ];
}
