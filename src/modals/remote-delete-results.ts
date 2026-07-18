import { App, Modal, Setting } from 'obsidian';
import { t } from '../i18n';
import type { RemoteDeleteResult, RemoteObject } from '../remote/types';

interface RemoteDeleteResultsOptions {
    onStop: () => void;
    onClose?: () => void;
    onRetry: (objects: readonly RemoteObject[]) => void;
    onRescan: () => void;
}

/** Live, redacted results for one bounded remote delete batch. */
export class RemoteDeleteResultsModal extends Modal {
    private results = new Map<string, { object: RemoteObject; result: RemoteDeleteResult }>();
    private listEl: HTMLElement | null = null;
    private statusEl: HTMLElement | null = null;
    private retryButton: HTMLButtonElement | null = null;
    private rescanButton: HTMLButtonElement | null = null;
    private finished = false;
    private closed = false;

    constructor(app: App, private total: number, private options: RemoteDeleteResultsOptions) {
        super(app);
    }

    onOpen(): void {
        this.contentEl.addClass('remote-delete-results');
        new Setting(this.contentEl).setName(t('modal.remoteDeleteResults.title')).setHeading();
        this.statusEl = this.contentEl.createDiv({ cls: 'remote-delete-result-status' });
        this.listEl = this.contentEl.createDiv({ cls: 'remote-delete-result-list' });
        const actions = this.contentEl.createDiv({ cls: 'remote-delete-actions' });
        this.retryButton = actions.createEl('button', { text: t('modal.remoteDeleteResults.retry') });
        this.retryButton.disabled = true;
        this.retryButton.addEventListener('click', () => {
            const failures = [...this.results.values()]
                .filter(({ result }) => !result.success)
                .map(({ object }) => object);
            if (failures.length > 0) this.options.onRetry(failures);
        });
        this.rescanButton = actions.createEl('button', { text: t('modal.remoteDeleteResults.rescan') });
        this.rescanButton.disabled = true;
        this.rescanButton.addEventListener('click', this.options.onRescan);
        this.render();
    }

    addResult(object: RemoteObject, result: RemoteDeleteResult): void {
        this.results.set(object.key, { object, result });
        if (!this.closed) this.render();
    }

    finish(): void {
        this.finished = true;
        if (!this.closed) this.render();
    }

    onClose(): void {
        this.closed = true;
        this.options.onStop();
        this.options.onClose?.();
        this.contentEl.empty();
    }

    private render(): void {
        if (!this.listEl || !this.statusEl) return;
        this.statusEl.textContent = t(
            this.finished ? 'modal.remoteDeleteResults.finished' : 'modal.remoteDeleteResults.progress',
            { completed: String(this.results.size), total: String(this.total) }
        );
        this.listEl.empty();
        for (const { object, result } of this.results.values()) {
            const row = this.listEl.createDiv({ cls: 'remote-delete-result-row' });
            row.createSpan({ text: object.key });
            row.createSpan({
                cls: result.success ? 'mod-success' : 'mod-warning',
                text: resultLabel(result),
            });
        }
        if (this.retryButton) {
            this.retryButton.disabled = !this.finished || ![...this.results.values()]
                .some(({ result }) => !result.success);
        }
        if (this.rescanButton) this.rescanButton.disabled = !this.finished;
    }
}

function resultLabel(result: RemoteDeleteResult): string {
    if (result.success) return t('modal.remoteDeleteResults.success');
    const code = result.failureCode ?? 'unknown';
    const keys: Record<NonNullable<RemoteDeleteResult['failureCode']>, string> = {
        configuration: 'modal.remoteDeleteResults.configuration',
        authentication: 'modal.remoteDeleteResults.authentication',
        permission: 'modal.remoteDeleteResults.permission',
        'not-found': 'modal.remoteDeleteResults.notFound',
        'rate-limit': 'modal.remoteDeleteResults.rateLimit',
        network: 'modal.remoteDeleteResults.network',
        parsing: 'modal.remoteDeleteResults.parsing',
        unsupported: 'modal.remoteDeleteResults.unsupported',
        service: 'modal.remoteDeleteResults.service',
        unknown: 'modal.remoteDeleteResults.unknown',
        conflict: 'modal.remoteDeleteResults.conflict',
        precondition: 'modal.remoteDeleteResults.precondition',
        locked: 'modal.remoteDeleteResults.locked',
    };
    return t(keys[code]);
}
