import { App, Modal, Notice, Setting } from 'obsidian';
import type { ButtonComponent } from 'obsidian';
import { t } from '../i18n';
import type { NoteScope } from '../utils/note-scope';
import type { UrlPrefixMigrationPlan } from '../remote/url-prefix-migration';
import { NoteTargetPicker } from './note-target-picker';

export interface MigrateUrlPrefixDialogActions {
    preview: (scope: NoteScope, fromBase: string, toBase: string) => Promise<UrlPrefixMigrationPlan>;
    execute: (plan: UrlPrefixMigrationPlan) => Promise<void>;
}

/** Collects old/new public URL bases and a note scope; migration begins only after explicit confirmation. */
export class MigrateUrlPrefixDialog extends Modal {
    private noteScope: NoteScope = { kind: 'vault' };
    private fromBase = '';
    private toBase = '';
    private pending = false;
    private closed = false;
    private previewVersion = 0;
    private previewTimer: number | undefined;
    private currentPlan: UrlPrefixMigrationPlan | undefined;
    private summaryEl: HTMLElement | undefined;
    private startButton: ButtonComponent | undefined;

    constructor(app: App, private readonly actions: MigrateUrlPrefixDialogActions, initial?: { fromBase?: string; toBase?: string }) {
        super(app);
        this.fromBase = initial?.fromBase ?? '';
        this.toBase = initial?.toBase ?? '';
    }

    onOpen(): void {
        this.closed = false;
        this.render();
    }

    onClose(): void {
        this.closed = true;
        this.previewVersion++;
        if (this.previewTimer !== undefined) window.clearTimeout(this.previewTimer);
        this.previewTimer = undefined;
        this.contentEl.empty();
    }

    private render(): void {
        const version = ++this.previewVersion;
        const root = this.contentEl;
        root.empty();
        this.summaryEl = undefined;
        this.startButton = undefined;
        this.currentPlan = undefined;

        new Setting(root).setName(t('migrate.title')).setHeading();
        root.createEl('p', { text: t('migrate.scopeHelp') });

        new Setting(root).setName(t('migrate.fromBase')).addText(text => text
            .setPlaceholder('Old.example.com/bucket')
            .setValue(this.fromBase)
            .onChange(value => {
                this.fromBase = value;
                this.schedulePreview();
            }));

        new Setting(root).setName(t('migrate.toBase')).addText(text => text
            .setPlaceholder('New.example.com/bucket')
            .setValue(this.toBase)
            .onChange(value => {
                this.toBase = value;
                this.schedulePreview();
            }));

        new Setting(root).setName(t('upload.scope')).addDropdown(dropdown => dropdown
            .addOption('vault', t('upload.vault'))
            .addOption('folder', t('upload.folder'))
            .addOption('note', t('upload.note'))
            .setValue(this.noteScope.kind)
            .onChange(value => {
                if (value === 'vault') this.noteScope = { kind: 'vault' };
                else if (value === 'folder') this.noteScope = { kind: 'folder', path: '' };
                else this.noteScope = { kind: 'note', path: this.app.workspace.getActiveFile()?.extension === 'md' ? this.app.workspace.getActiveFile()!.path : '' };
                this.render();
            }));

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

        this.summaryEl = root.createEl('p', { text: t('migrate.preview'), attr: { 'aria-live': 'polite' } });

        new Setting(root)
            .addButton(button => button.setButtonText(t('modal.confirm.cancel')).onClick(() => this.close()))
            .addButton(button => {
                this.startButton = button;
                button.setButtonText(t('migrate.start')).setCta().setDisabled(true).onClick(() => this.run());
            });

        void this.refreshPreview(version);
    }

    private schedulePreview(): void {
        if (this.previewTimer !== undefined) window.clearTimeout(this.previewTimer);
        // Invalidate the old plan immediately so a stale plan can never be submitted during debounce.
        this.currentPlan = undefined;
        this.startButton?.setDisabled(true);
        const version = ++this.previewVersion;
        this.previewTimer = window.setTimeout(() => {
            this.previewTimer = undefined;
            void this.refreshPreview(version);
        }, 300);
    }

    private async refreshPreview(version: number): Promise<void> {
        const fromBase = this.fromBase.trim();
        const toBase = this.toBase.trim();
        const summary = this.summaryEl;
        const button = this.startButton;
        if (!summary || !button) return;

        if (!fromBase || !toBase || fromBase === toBase) {
            summary.setText(t('migrate.invalid'));
            button.setDisabled(true);
            return;
        }
        if (this.noteScope.kind === 'note' && !this.noteScope.path) {
            summary.setText(t('migrate.selectNote'));
            button.setDisabled(true);
            return;
        }

        summary.setText(t('migrate.scanning'));
        button.setDisabled(true);
        try {
            const plan = await this.actions.preview(this.noteScope, fromBase, toBase);
            if (this.closed || version !== this.previewVersion) return;
            this.currentPlan = plan;
            summary.setText(t('migrate.summary', { notes: String(plan.notePaths.length), refs: String(plan.referenceCount) }));
            button.setDisabled(plan.notePaths.length === 0);
        } catch {
            if (!this.closed && version === this.previewVersion) summary.setText(t('migrate.failed'));
        }
    }

    private run(): void {
        const plan = this.currentPlan;
        const fromBase = this.fromBase.trim();
        const toBase = this.toBase.trim();
        if (this.pending || !plan || plan.notePaths.length === 0) return;
        // Reject a stale plan that no longer matches the current inputs.
        if (plan.fromBase !== fromBase || plan.toBase !== toBase) return;
        this.pending = true;
        const root = this.contentEl;
        root.empty();
        new Setting(root).setName(t('migrate.running')).setHeading();
        root.createEl('p', { text: t('migrate.runningHelp') });
        void this.execute(plan);
    }

    private async execute(plan: UrlPrefixMigrationPlan): Promise<void> {
        try {
            await this.actions.execute(plan);
        } catch {
            new Notice(t('migrate.failed'));
        } finally {
            if (!this.closed) this.close();
        }
    }
}
