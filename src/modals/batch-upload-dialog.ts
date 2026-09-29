import { App, Modal, Notice, Setting } from 'obsidian';
import type { ImageHostingConfig } from '../types';
import type { UploadPlan, UploadScope } from '../uploaders/upload-scope';
import { t } from '../i18n';
import { NoteTargetPicker } from './note-target-picker';

export interface BatchUploadDialogActions {
    getHostings: () => ImageHostingConfig[];
    prepare: (scope: UploadScope) => Promise<UploadPlan>;
    execute: (plan: UploadPlan, hosting: ImageHostingConfig, replace: boolean) => Promise<void>;
}

/** Local planning only until explicit confirmation. Closing does not cancel sent requests. */
export class BatchUploadDialog extends Modal {
    private uploadScope: UploadScope;
    private hostingId = '';
    private replace: boolean;
    private pending = false;
    private closed = false;
    private generation = 0;
    constructor(app: App, scope: UploadScope, replace: boolean, private readonly actions: BatchUploadDialogActions) {
        super(app);
        this.uploadScope = scope;
        this.replace = replace;
    }
    onOpen(): void { this.closed = false; void this.render(); }
    onClose(): void { this.closed = true; this.generation++; this.contentEl.empty(); }

    private render(): void {
        const generation = ++this.generation;
        const root = this.contentEl;
        root.empty();
        new Setting(root).setName(t('upload.title')).setHeading();
        root.createEl('p', { text: t('upload.scopeHelp') });
        new Setting(root).setName(t('upload.scope')).addDropdown(dropdown => {
            dropdown.addOption('vault', t('upload.vault')).addOption('folder', t('upload.folder')).addOption('note', t('upload.note'))
                .setValue(this.uploadScope.kind).onChange(value => {
                    if (value === 'vault') this.uploadScope = { kind: 'vault' };
                    else if (value === 'folder') this.uploadScope = { kind: 'folder', path: '' };
                    else this.uploadScope = { kind: 'note', path: this.app.workspace.getActiveFile()?.extension === 'md' ? this.app.workspace.getActiveFile()!.path : '' };
                    void this.render();
                });
        });
        if (this.uploadScope.kind !== 'vault') {
            const kind = this.uploadScope.kind;
            new Setting(root).setName(t(kind === 'folder' ? 'upload.folder' : 'upload.note'))
                .setDesc(this.uploadScope.path || (kind === 'folder' ? '/' : t('upload.selectTarget')))
                .addButton(button => button.setButtonText(t('upload.selectTarget')).onClick(() => {
                    new NoteTargetPicker(this.app, kind, file => {
                        if (this.closed || this.pending) return;
                        this.uploadScope = { kind, path: file.path === '/' ? '' : file.path };
                        void this.render();
                    }).open();
                }));
        }
        const hostings = this.actions.getHostings().filter(config => config.enabled);
        if (!hostings.some(config => config.id === this.hostingId)) this.hostingId = hostings[0]?.id ?? '';
        new Setting(root).setName(t('upload.hosting')).addDropdown(dropdown => {
            for (const hosting of hostings) dropdown.addOption(hosting.id, hosting.name);
            dropdown.setValue(this.hostingId).onChange(value => { this.hostingId = value; });
        });
        new Setting(root).setName(t('upload.replace')).setDesc(t('upload.replaceHelp'))
            .addToggle(toggle => toggle.setValue(this.replace).onChange(value => { this.replace = value; }));
        root.createEl('p', { text: t('upload.keepLocal') });
        const summary = root.createEl('p', { text: t('upload.scanning'), attr: { 'aria-live': 'polite' } });
        let plan: UploadPlan | undefined;
        new Setting(root)
            .addButton(button => button.setButtonText(t('modal.confirm.cancel')).onClick(() => this.close()))
            .addButton(button => {
                button.setButtonText(t('upload.start')).setCta().setDisabled(true).onClick(() => {
                    if (this.pending || !plan || !plan.sources.length) return;
                    const hosting = this.actions.getHostings().find(config => config.enabled && config.id === this.hostingId);
                    if (!hosting) { new Notice(t('notice.noHostingConfig')); return; }
                    this.pending = true;
                    const frozenPlan = plan;
                    const frozenHosting = structuredClone(hosting);
                    const replace = this.replace;
                    // Remove configurable controls while running; Escape/close does not abort requests.
                    root.empty();
                    new Setting(root).setName(t('upload.running')).setHeading();
                    root.createEl('p', { text: t('upload.runningHelp') });
                    void this.actions.execute(frozenPlan, frozenHosting, replace)
                        .catch(() => { new Notice(t('upload.failed')); })
                        .finally(() => { if (!this.closed) this.close(); });
                });
                void this.actions.prepare(this.uploadScope).then(result => {
                    if (this.closed || generation !== this.generation) return;
                    plan = result;
                    summary.setText(t('upload.summary', { notes: String(result.notes.length), images: String(result.sources.length), skipped: String(result.skipped.length) }));
                    button.setDisabled(!result.sources.length || !hostings.length);
                    if (!hostings.length) summary.setText(t('notice.noHostingConfig'));
                }).catch(() => {
                    if (!this.closed && generation === this.generation) summary.setText(t('upload.failed'));
                });
            });
    }
}
