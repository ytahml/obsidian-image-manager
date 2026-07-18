import { App, Modal, Setting } from 'obsidian';
import { t } from '../i18n';
import { formatFileSize } from '../utils/path-utils';
import type { RemoteDeleteBatchSnapshot } from '../remote/delete-session';
import type { RemoteReferenceState } from '../remote/types';
import { canConfirmRemoteDelete } from '../remote/delete-confirmation';

interface RemoteDeleteConfirmOptions {
    hostingName: string;
    bucket: string;
    prefix: string;
    batch: RemoteDeleteBatchSnapshot;
    validate: () => boolean;
    onConfirm: () => void;
    onInvalid: () => void;
}

/** Destructive confirmation that requires typing the exact selected count. */
export class RemoteDeleteConfirmModal extends Modal {
    constructor(private options: RemoteDeleteConfirmOptions, app: App) {
        super(app);
    }

    onOpen(): void {
        this.contentEl.addClass('remote-delete-confirm');
        new Setting(this.contentEl).setName(t('modal.remoteDeleteConfirm.title')).setHeading();
        const summary = this.contentEl.createDiv({ cls: 'remote-delete-summary' });
        summary.createDiv({ text: t('modal.remoteDeleteConfirm.hosting', { name: this.options.hostingName }) });
        summary.createDiv({ text: t('modal.remoteDeleteConfirm.bucket', { bucket: this.options.bucket }) });
        summary.createDiv({ text: t('modal.remoteDeleteConfirm.prefix', { prefix: this.options.prefix || '/' }) });
        summary.createDiv({ text: t('modal.remoteDeleteConfirm.scannedAt', {
            time: new Date(this.options.batch.scannedAt).toLocaleString(),
        }) });
        summary.createDiv({ text: t('modal.remoteDeleteConfirm.selection', {
            count: String(this.options.batch.objects.length),
            size: formatFileSize(this.options.batch.totalSize),
        }) });
        this.contentEl.createDiv({
            cls: 'remote-delete-warning mod-warning',
            text: t('modal.remoteDeleteConfirm.warning'),
        });

        const list = this.contentEl.createEl('ul', { cls: 'remote-delete-object-list' });
        for (const object of this.options.batch.objects) {
            const state = this.options.batch.states.get(`${object.hostingId}\u0000${object.key}`);
            list.createEl('li', {
                text: `${object.key} · ${formatFileSize(object.size)} · ${stateLabel(state)}`,
            });
        }

        const inputSetting = new Setting(this.contentEl)
            .setName(t('modal.remoteDeleteConfirm.input', {
                count: String(this.options.batch.objects.length),
            }));
        let inputValue = '';
        let acknowledged = false;
        let confirmButton: HTMLButtonElement | null = null;
        const updateConfirmButton = () => {
            if (confirmButton) {
                confirmButton.disabled = !canConfirmRemoteDelete(
                    inputValue,
                    this.options.batch.objects.length,
                    acknowledged
                );
            }
        };
        const submit = () => {
            if (!canConfirmRemoteDelete(inputValue, this.options.batch.objects.length, acknowledged)) return;
            if (!this.options.validate()) {
                this.options.onInvalid();
                this.close();
                return;
            }
            this.close();
            this.options.onConfirm();
        };
        inputSetting.addText((text) => {
            text.inputEl.type = 'text';
            text.onChange((value) => {
                inputValue = value;
                updateConfirmButton();
            });
            text.inputEl.addEventListener('keydown', (event) => {
                if (event.isComposing || event.key !== 'Enter') return;
                event.preventDefault();
                submit();
            });
        });

        const acknowledgement = this.contentEl.createEl('label', {
            cls: 'remote-delete-acknowledgement',
        });
        const acknowledgementInput = acknowledgement.createEl('input', {
            attr: { type: 'checkbox' },
        });
        acknowledgement.createSpan({ text: t('modal.remoteDeleteConfirm.acknowledge') });
        acknowledgementInput.addEventListener('change', () => {
            acknowledged = acknowledgementInput.checked;
            updateConfirmButton();
        });

        const actions = this.contentEl.createDiv({ cls: 'remote-delete-actions' });
        actions.createEl('button', { text: t('modal.confirm.cancel') })
            .addEventListener('click', () => this.close());
        confirmButton = actions.createEl('button', {
            text: t('modal.remoteDeleteConfirm.confirm'),
            cls: 'mod-warning',
        });
        confirmButton.disabled = true;
        confirmButton.addEventListener('click', submit);
    }

    onClose(): void {
        this.contentEl.empty();
    }
}

function stateLabel(state: RemoteReferenceState | undefined): string {
    return state === 'not-referenced-in-current-vault'
        ? t('modal.imageBrowser.remoteNotReferenced')
        : t('modal.imageBrowser.remoteUnmappable');
}
