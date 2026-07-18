import { App, Modal, Setting } from 'obsidian';
import { t } from '../i18n';
import { RemoteProviderError } from '../remote/errors';
import type { RemoteObject, RemotePreviewUrl } from '../remote/types';
import { formatFileSize } from '../utils/path-utils';

type PreviewResolver = (force: boolean) => Promise<RemotePreviewUrl | undefined>;

/** One manually requested remote image. No URL is retained after this modal closes. */
export class RemoteImagePreviewModal extends Modal {
    private generation = 0;
    private closed = false;
    private imageEl: HTMLImageElement | null = null;
    private imageLoadHandler: (() => void) | null = null;
    private imageErrorHandler: (() => void) | null = null;

    constructor(
        app: App,
        private readonly object: RemoteObject,
        private readonly resolvePreview: PreviewResolver,
        private readonly onImageRequest: () => void,
        private readonly onClosed: () => void
    ) {
        super(app);
    }

    onOpen(): void {
        this.closed = false;
        this.contentEl.addClass('remote-image-preview');
        void this.load(false);
    }

    onClose(): void {
        this.closed = true;
        this.generation++;
        this.cleanupImage();
        this.contentEl.empty();
        this.onClosed();
    }

    private async load(force: boolean): Promise<void> {
        const generation = ++this.generation;
        this.cleanupImage();
        this.renderShell(t('modal.remotePreview.loading'));

        try {
            const preview = await this.resolvePreview(force);
            if (!preview || this.closed || generation !== this.generation) return;
            this.renderImage(preview, generation);
        } catch (error) {
            if (this.closed || generation !== this.generation) return;
            this.renderFailure(error);
        }
    }

    private renderShell(status: string): HTMLElement {
        this.contentEl.empty();
        new Setting(this.contentEl)
            .setName(t('modal.remotePreview.title'))
            .setHeading();
        this.contentEl.createDiv({ cls: 'remote-image-preview-key', text: this.object.key });
        return this.contentEl.createDiv({ cls: 'remote-image-preview-status', text: status });
    }

    private renderImage(preview: RemotePreviewUrl, generation: number): void {
        const status = this.renderShell(t('modal.remotePreview.loading'));
        const image = this.contentEl.createEl('img', {
            cls: 'remote-image-preview-img',
            attr: {
                alt: this.object.key,
                referrerpolicy: 'no-referrer',
            },
        });
        this.imageEl = image;
        this.imageLoadHandler = () => {
            if (this.closed || generation !== this.generation) return;
            status.textContent = t('modal.remotePreview.loaded');
        };
        this.imageErrorHandler = () => {
            if (this.closed || generation !== this.generation) return;
            this.cleanupImage();
            this.renderFailure();
        };
        image.addEventListener('load', this.imageLoadHandler);
        image.addEventListener('error', this.imageErrorHandler);

        const info = this.contentEl.createDiv({ cls: 'remote-image-preview-info' });
        info.createSpan({ text: t('modal.remotePreview.size', { size: formatFileSize(this.object.size) }) });
        info.createSpan({
            text: t('modal.remotePreview.modified', {
                time: this.object.lastModified
                    ? new Date(this.object.lastModified).toLocaleString()
                    : '—',
            }),
        });
        info.createSpan({
            text: preview.access === 'presigned'
                ? t('modal.remotePreview.privateAccess')
                : t('modal.remotePreview.publicAccess'),
        });

        this.onImageRequest();
        image.src = preview.url;
    }

    private renderFailure(error?: unknown): void {
        this.renderShell(getPreviewErrorMessage(error));
        const buttons = this.contentEl.createDiv({ cls: 'remote-image-preview-actions' });
        const retry = buttons.createEl('button', {
            cls: 'mod-cta',
            text: t('modal.remotePreview.retry'),
        });
        retry.addEventListener('click', () => void this.load(true));
    }

    private cleanupImage(): void {
        if (!this.imageEl) return;
        if (this.imageLoadHandler) {
            this.imageEl.removeEventListener('load', this.imageLoadHandler);
        }
        if (this.imageErrorHandler) {
            this.imageEl.removeEventListener('error', this.imageErrorHandler);
        }
        this.imageEl.removeAttribute('src');
        this.imageEl = null;
        this.imageLoadHandler = null;
        this.imageErrorHandler = null;
    }
}

function getPreviewErrorMessage(error?: unknown): string {
    if (error instanceof RemoteProviderError) {
        if (error.code === 'configuration') return t('modal.remotePreview.configurationError');
        if (error.code === 'unsupported') return t('modal.remotePreview.unsupported');
    }
    return t('modal.remotePreview.loadFailed');
}
