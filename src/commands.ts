import type { Command, TFile } from 'obsidian';
import { t } from './i18n';

type FileAction = (file: TFile) => void | Promise<void>;
export interface ImageCommandActions {
    getActiveFile: () => TFile | null;
    isImage: (file: TFile) => boolean;
    browserEnabled: () => boolean;
    browse: () => void;
    compress: FileAction;
    convertScope: () => void;
    uploadImage: FileAction;
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
        { id: 'convert-reference-format', name: t('command.convertReference'), callback: actions.convertScope },
        fileCommand('upload-to-hosting', 'command.uploadToHosting', actions.isImage, actions.uploadImage),
        { id: 'batch-upload', name: t('command.batchUpload'), callback: actions.uploadScope },
        { id: 'find-orphan-images', name: t('command.findOrphans'), callback: actions.findOrphans },
        fileCommand('rename-image', 'command.renameImage', actions.isImage, actions.rename),
        fileCommand('reorganize-images', 'command.reorganizeImages', markdown, actions.reorganize),
    ];
}
