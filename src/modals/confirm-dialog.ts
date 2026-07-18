import { App, Modal } from 'obsidian';
import { t } from '../i18n';

export interface ConfirmDialogOptions {
    title: string;
    message: string;
    confirmText?: string;
    pendingText?: string;
    cancelText?: string;
    onConfirm: () => void | Promise<void>;
    onCancel?: () => void;
}

export class ConfirmDialog extends Modal {
    private options: ConfirmDialogOptions;
    private keyHandler: (e: KeyboardEvent) => void;
    private confirmButton: HTMLButtonElement | null = null;
    private cancelButton: HTMLButtonElement | null = null;
    private pending = false;

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

        this.cancelButton = buttonContainer.createEl('button', {
            text: this.options.cancelText ?? t('modal.confirm.cancel'),
        });
        this.cancelButton.addEventListener('click', () => {
            if (this.pending) return;
            this.options.onCancel?.();
            this.close();
        });

        this.confirmButton = buttonContainer.createEl('button', {
            text: this.options.confirmText ?? t('modal.confirm.ok'),
            cls: 'mod-cta',
        });
        this.confirmButton.addEventListener('click', () => void this.handleConfirm());

        activeDocument.addEventListener('keydown', this.keyHandler);
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
        activeDocument.removeEventListener('keydown', this.keyHandler);
    }

    private async handleConfirm() {
        if (this.pending) return;
        this.pending = true;
        this.contentEl.setAttribute('aria-busy', 'true');
        if (this.cancelButton) this.cancelButton.disabled = true;
        if (this.confirmButton) {
            this.confirmButton.disabled = true;
            this.confirmButton.empty();
            this.confirmButton.addClass('confirm-dialog-pending');
            this.confirmButton.createSpan({ cls: 'confirm-dialog-spinner' });
            this.confirmButton.createSpan({
                text: this.options.pendingText ?? t('modal.confirm.processing'),
            });
        }
        try {
            await this.options.onConfirm();
        } finally {
            this.close();
        }
    }
}
