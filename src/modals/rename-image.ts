import { App, Modal, TFile } from 'obsidian';
import { t } from '../i18n';

export class RenameImageModal extends Modal {
    private file: TFile;
    private onSubmit: (newName: string) => void;

    constructor(app: App, file: TFile, onSubmit: (newName: string) => void) {
        super(app);
        this.file = file;
        this.onSubmit = onSubmit;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.addClass('rename-image');

        contentEl.createEl('h2', { text: t('modal.rename.title') });
        contentEl.createEl('p', {
            text: t('modal.rename.desc', { name: this.file.name }),
            cls: 'rename-image-desc',
        });

        const form = contentEl.createDiv({ cls: 'rename-image-form' });

        const ext = this.file.name.includes('.') ? '.' + this.file.name.split('.').pop() : '';
        const stem = ext ? this.file.name.slice(0, -ext.length) : this.file.name;

        const input = form.createEl('input', {
            attr: {
                type: 'text',
                value: stem,
            },
            cls: 'rename-image-input',
        });
        input.select();

        const buttons = form.createDiv({ cls: 'rename-image-buttons' });

        const cancelBtn = buttons.createEl('button', {
            text: t('modal.confirm.cancel'),
        });
        cancelBtn.addEventListener('click', () => this.close());

        const confirmBtn = buttons.createEl('button', {
            text: t('modal.rename.confirm'),
            cls: 'mod-cta',
        });
        confirmBtn.addEventListener('click', () => {
            const newStem = input.value.trim();
            if (!newStem || newStem === stem) {
                this.close();
                return;
            }
            this.onSubmit(newStem + ext);
            this.close();
        });

        input.addEventListener('keydown', (e) => {
            if (e.isComposing) return;
            if (e.key === 'Enter') {
                e.preventDefault();
                confirmBtn.click();
            }
        });
    }

    onClose() {
        this.contentEl.empty();
    }
}
