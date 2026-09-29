import { App, FuzzySuggestModal, TFile, TFolder, type TAbstractFile } from 'obsidian';
import type { NoteScope } from '../utils/note-scope';

export type NoteTargetKind = Exclude<NoteScope['kind'], 'vault'>;

export class NoteTargetPicker extends FuzzySuggestModal<TAbstractFile> {
    constructor(
        app: App,
        private readonly kind: NoteTargetKind,
        private readonly choose: (file: TAbstractFile) => void,
    ) { super(app); }

    getItems(): TAbstractFile[] {
        return this.app.vault.getAllLoadedFiles().filter(file =>
            this.kind === 'folder' ? file instanceof TFolder : file instanceof TFile && file.extension === 'md');
    }

    getItemText(file: TAbstractFile): string { return file.path || '/'; }
    onChooseItem(file: TAbstractFile): void { this.choose(file); }
}
