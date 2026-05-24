import { App, Modal } from 'obsidian';
import { t } from '../i18n';

export class ImageNamePromptModal extends Modal {
    private defaultName: string;
    private onSubmit: (name: string) => void;

    constructor(app: App, defaultName: string, onSubmit: (name: string) => void) {
        super(app);
        this.defaultName = defaultName;
        this.onSubmit = onSubmit;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.addClass('image-name-prompt');

        contentEl.createEl('h2', { text: t('modal.imageName.title') });

        const input = contentEl.createEl('input', {
            cls: 'image-name-prompt-input',
            attr: {
                type: 'text',
                value: this.defaultName,
                placeholder: t('modal.imageName.placeholder'),
            },
        });
        input.select();

        const buttons = contentEl.createDiv({ cls: 'image-name-prompt-buttons' });

        const cancelBtn = buttons.createEl('button', { text: t('modal.confirm.cancel') });
        cancelBtn.addEventListener('click', () => {
            this.close();
        });

        const confirmBtn = buttons.createEl('button', { text: t('modal.confirm.ok'), cls: 'mod-cta' });
        confirmBtn.addEventListener('click', () => {
            const name = input.value.trim() || this.defaultName;
            this.onSubmit(name);
            this.close();
        });

        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                confirmBtn.click();
            } else if (e.key === 'Escape') {
                this.close();
            }
        });
    }

    onClose() {
        this.contentEl.empty();
    }
}
