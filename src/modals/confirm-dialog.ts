import { App, Modal } from 'obsidian';
import { t } from '../i18n';

export interface ConfirmDialogOptions {
    title: string;
    message: string;
    confirmText?: string;
    cancelText?: string;
    onConfirm: () => void | Promise<void>;
    onCancel?: () => void;
}

export class ConfirmDialog extends Modal {
    private options: ConfirmDialogOptions;
    private keyHandler: (e: KeyboardEvent) => void;

    constructor(app: App, options: ConfirmDialogOptions) {
        super(app);
        this.options = options;

        this.keyHandler = (e: KeyboardEvent) => {
            if (e.isComposing) return;
            if (e.key === 'Enter') {
                e.preventDefault();
                void this.handleConfirm();
            }
        };
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.addClass('confirm-dialog');

        contentEl.createEl('h2', { text: this.options.title });

        contentEl.createEl('p', {
            text: this.options.message,
            cls: 'confirm-dialog-message',
        });

        const buttonContainer = contentEl.createDiv({ cls: 'confirm-dialog-buttons' });

        const cancelBtn = buttonContainer.createEl('button', {
            text: this.options.cancelText ?? t('modal.confirm.cancel'),
        });
        cancelBtn.addEventListener('click', () => {
            this.options.onCancel?.();
            this.close();
        });

        const confirmBtn = buttonContainer.createEl('button', {
            text: this.options.confirmText ?? t('modal.confirm.ok'),
            cls: 'mod-cta',
        });
        confirmBtn.addEventListener('click', () => void this.handleConfirm());

        activeDocument.addEventListener('keydown', this.keyHandler);
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
        activeDocument.removeEventListener('keydown', this.keyHandler);
    }

    private async handleConfirm() {
        await this.options.onConfirm();
        this.close();
    }
}
