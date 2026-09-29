import { App, Modal, Notice, Setting } from 'obsidian';
import { t } from '../i18n';
import type { NoteScope } from '../utils/note-scope';
import { NoteTargetPicker } from './note-target-picker';

export interface ConvertReferenceDialogActions {
    execute: (scope: NoteScope) => Promise<void>;
}

/** Chooses a note scope; conversion begins only after explicit confirmation. */
export class ConvertReferenceDialog extends Modal {
    private noteScope: NoteScope;
    private pending = false;
    private closed = false;

    constructor(app: App, scope: NoteScope, private readonly actions: ConvertReferenceDialogActions) {
        super(app);
        this.noteScope = scope;
    }

    onOpen(): void { this.closed = false; this.render(); }
    onClose(): void { this.closed = true; this.contentEl.empty(); }

    private async execute(scope: NoteScope): Promise<void> {
        try {
            await this.actions.execute(scope);
        } catch {
            new Notice(t('convert.failed'));
        } finally {
            if (!this.closed) this.close();
        }
    }

    private render(): void {
        const root = this.contentEl;
        root.empty();
        new Setting(root).setName(t('command.convertReference')).setHeading();
        root.createEl('p', { text: t('convert.scopeHelp') });
        new Setting(root).setName(t('upload.scope')).addDropdown(dropdown => {
            dropdown.addOption('vault', t('upload.vault'))
                .addOption('folder', t('upload.folder'))
                .addOption('note', t('upload.note'))
                .setValue(this.noteScope.kind)
                .onChange(value => {
                    if (value === 'vault') this.noteScope = { kind: 'vault' };
                    else if (value === 'folder') this.noteScope = { kind: 'folder', path: '' };
                    else {
                        const active = this.app.workspace.getActiveFile();
                        this.noteScope = { kind: 'note', path: active?.extension === 'md' ? active.path : '' };
                    }
                    this.render();
                });
        });
        if (this.noteScope.kind !== 'vault') {
            const kind = this.noteScope.kind;
            new Setting(root).setName(t(kind === 'folder' ? 'upload.folder' : 'upload.note'))
                .setDesc(this.noteScope.path || (kind === 'folder' ? '/' : t('upload.selectTarget')))
                .addButton(button => button.setButtonText(t('upload.selectTarget')).onClick(() => {
                    new NoteTargetPicker(this.app, kind, file => {
                        if (this.closed || this.pending) return;
                        this.noteScope = { kind, path: file.path === '/' ? '' : file.path };
                        this.render();
                    }).open();
                }));
        }
        const valid = this.noteScope.kind !== 'note' || this.noteScope.path.length > 0;
        new Setting(root)
            .addButton(button => button.setButtonText(t('modal.confirm.cancel')).onClick(() => this.close()))
            .addButton(button => button.setButtonText(t('convert.start')).setCta().setDisabled(!valid).onClick(() => {
                if (this.pending || !valid) return;
                this.pending = true;
                const scope = this.noteScope;
                root.empty();
                new Setting(root).setName(t('convert.running')).setHeading();
                void this.execute(scope);
            }));
    }
}
