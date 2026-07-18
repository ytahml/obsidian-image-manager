import { App, MarkdownView, Modal, Setting } from 'obsidian';
import { t } from '../i18n';
import { RemoteProviderError } from '../remote/errors';
import type { RemoteObject, RemotePreviewUrl, RemoteReferenceLocation } from '../remote/types';
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
        private readonly onClosed: () => void,
        private readonly references: readonly RemoteReferenceLocation[] = [],
        private readonly closeBrowser: () => void = () => {}
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
        this.renderShell();
        this.renderPreviewState(t('modal.remotePreview.loading'), true);
        this.renderReferences();

        try {
            const preview = await this.resolvePreview(force);
            if (!preview || this.closed || generation !== this.generation) return;
            this.renderImage(preview, generation);
        } catch (error) {
            if (this.closed || generation !== this.generation) return;
            this.renderFailure(error);
        }
    }

    private renderShell(): void {
        this.contentEl.empty();
        new Setting(this.contentEl)
            .setName(t('modal.remotePreview.title'))
            .setHeading();
        this.contentEl.createDiv({ cls: 'remote-image-preview-key', text: this.object.key });
    }

    private renderImage(preview: RemotePreviewUrl, generation: number): void {
        this.renderShell();
        const media = this.renderPreviewState(t('modal.remotePreview.loading'), true);
        const image = media.createEl('img', {
            cls: 'remote-image-preview-img',
            attr: {
                alt: this.object.key,
                referrerpolicy: 'no-referrer',
            },
        });
        this.imageEl = image;
        this.imageLoadHandler = () => {
            if (this.closed || generation !== this.generation) return;
            media.addClass('is-loaded');
            media.querySelector('.remote-image-preview-state')?.remove();
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
        this.renderReferences();

        this.onImageRequest();
        image.src = preview.url;
    }

    private renderFailure(error?: unknown): void {
        this.renderShell();
        const media = this.renderPreviewState(getPreviewErrorMessage(error), false);
        media.addClass('is-error');
        const buttons = media.createDiv({ cls: 'remote-image-preview-actions' });
        const retry = buttons.createEl('button', {
            cls: 'mod-cta',
            text: t('modal.remotePreview.retry'),
        });
        retry.addEventListener('click', () => void this.load(true));
        this.renderReferences();
    }

    private renderPreviewState(message: string, loading: boolean): HTMLElement {
        const media = this.contentEl.createDiv({
            cls: 'remote-image-preview-media',
            attr: { 'aria-busy': String(loading) },
        });
        const state = media.createDiv({
            cls: 'remote-image-preview-state',
            attr: { role: 'status', 'aria-live': 'polite' },
        });
        if (loading) state.createDiv({ cls: 'remote-image-browser-spinner' });
        state.createSpan({ text: message });
        return media;
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

    private renderReferences(): void {
        const section = this.contentEl.createDiv({ cls: 'remote-image-preview-references' });
        if (this.references.length === 0) {
            section.createDiv({
                cls: 'image-preview-orphan',
                text: t('modal.remotePreview.noReferences'),
            });
            return;
        }
        const groups = groupReferences(this.references);
        section.createDiv({
            cls: 'image-preview-meta',
            text: t('modal.remotePreview.references', {
                total: String(this.references.length),
                notes: String(groups.length),
            }),
        });
        const list = section.createDiv({ cls: 'image-preview-notes' });
        for (const group of groups) {
            const row = list.createDiv({ cls: 'image-preview-note-item' });
            row.createSpan({ cls: 'image-preview-note-path', text: group.path });
            const lines = row.createSpan({ cls: 'image-preview-note-lines' });
            for (const line of group.lines) {
                const link = lines.createSpan({
                    cls: 'image-preview-note-line-link',
                    text: `:${line + 1}`,
                });
                link.addEventListener('click', () => this.openReference(group.path, line));
            }
        }
    }

    private openReference(path: string, line: number): void {
        this.close();
        this.closeBrowser();
        void this.app.workspace.openLinkText(path, path, true).then(() => {
            const view = this.app.workspace.getActiveViewOfType(MarkdownView);
            if (!view) return;
            view.editor.setCursor(line);
            view.editor.scrollIntoView(
                { from: { line, ch: 0 }, to: { line, ch: 0 } },
                true
            );
        });
    }
}

function groupReferences(references: readonly RemoteReferenceLocation[]): Array<{
    path: string;
    lines: number[];
}> {
    const groups = new Map<string, Set<number>>();
    for (const reference of references) {
        const lines = groups.get(reference.path) ?? new Set<number>();
        lines.add(reference.line);
        groups.set(reference.path, lines);
    }
    return [...groups].map(([path, lines]) => ({
        path,
        lines: [...lines].sort((left, right) => left - right),
    }));
}

function getPreviewErrorMessage(error?: unknown): string {
    if (error instanceof RemoteProviderError) {
        if (error.code === 'configuration') return t('modal.remotePreview.configurationError');
        if (error.code === 'unsupported') return t('modal.remotePreview.unsupported');
    }
    return t('modal.remotePreview.loadFailed');
}
