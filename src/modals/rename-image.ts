import { App, Modal, Notice, TFile } from 'obsidian';
import { BatchRename } from '../utils/batch-rename';
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

        const input = form.createEl('input', {
            attr: {
                type: 'text',
                value: this.file.name,
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
            const newName = input.value.trim();
            if (!newName || newName === this.file.name) {
                this.close();
                return;
            }
            this.onSubmit(newName);
            this.close();
        });

        input.addEventListener('keydown', (e) => {
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
