import { t } from '../i18n';
import type { RemoteObjectProvider } from '../remote/provider';
import type { RemoteDeleteUnavailableReason } from '../remote/delete-policy';
import type { RemotePreviewUnavailableReason } from '../remote/preview-policy';
import type { RemoteThumbnailSession } from '../remote/thumbnail-session';
import type { RemoteObject, RemoteReferenceLocation, RemoteReferenceState } from '../remote/types';
import { formatFileSize } from '../utils/path-utils';

const INITIAL_CARD_COUNT = 60;
const CARD_BATCH_SIZE = 60;

export interface RemoteImageGridItem {
    object: RemoteObject;
    referenceState: RemoteReferenceState;
    previewUnavailable?: RemotePreviewUnavailableReason;
    deleteUnavailable?: RemoteDeleteUnavailableReason;
    references: readonly RemoteReferenceLocation[];
}

interface RemoteImageGridOptions {
    container: HTMLElement;
    provider?: RemoteObjectProvider;
    deleteEnabled: boolean;
    items: readonly RemoteImageGridItem[];
    thumbnailSession: RemoteThumbnailSession;
    isSelected: (object: RemoteObject) => boolean;
    onSelectionChange: (object: RemoteObject, selected: boolean, checkbox: HTMLInputElement) => void;
    onPreview: (
        provider: RemoteObjectProvider,
        object: RemoteObject,
        references: readonly RemoteReferenceLocation[]
    ) => void;
    onImageRequest: () => void;
    previewUnavailableMessage: (reason: RemotePreviewUnavailableReason) => string;
    deleteUnavailableMessage: (reason: RemoteDeleteUnavailableReason) => string;
}

/** Responsive remote card grid with progressive rendering and viewport image loading. */
export class RemoteImageGrid {
    private gridEl: HTMLElement;
    private thumbnailObserver: IntersectionObserver | null = null;
    private appendObserver: IntersectionObserver | null = null;
    private sentinelEl: HTMLElement | null = null;
    private renderedCount = 0;
    private images = new Set<HTMLImageElement>();
    private destroyed = false;

    constructor(private options: RemoteImageGridOptions) {
        this.gridEl = options.container.createDiv({ cls: 'remote-image-grid' });
        this.createObservers();
        this.appendCards(INITIAL_CARD_COUNT);
    }

    destroy(): void {
        this.destroyed = true;
        this.thumbnailObserver?.disconnect();
        this.appendObserver?.disconnect();
        this.sentinelEl?.remove();
        this.sentinelEl = null;
        for (const image of this.images) {
            image.onload = null;
            image.onerror = null;
            image.removeAttribute('src');
        }
        this.images.clear();
    }

    private createObservers(): void {
        this.thumbnailObserver = new IntersectionObserver((entries) => {
            for (const entry of entries) {
                if (!entry.isIntersecting) continue;
                this.thumbnailObserver?.unobserve(entry.target);
                const load = (entry.target as HTMLElement).dataset.remoteLoadId;
                if (!load) continue;
                const item = this.options.items[Number(load)];
                if (item) this.loadThumbnail(entry.target as HTMLElement, item);
            }
        }, { root: this.gridEl, rootMargin: '200px' });
        this.appendObserver = new IntersectionObserver((entries) => {
            if (entries.some((entry) => entry.isIntersecting)) this.appendCards(CARD_BATCH_SIZE);
        }, { root: this.gridEl, rootMargin: '300px' });
    }

    private appendCards(count: number): void {
        if (this.destroyed || this.renderedCount >= this.options.items.length) return;
        this.appendObserver?.disconnect();
        this.sentinelEl?.remove();
        this.sentinelEl = null;
        const end = Math.min(this.options.items.length, this.renderedCount + count);
        for (let index = this.renderedCount; index < end; index++) {
            const item = this.options.items[index];
            if (item) this.renderCard(item, index);
        }
        this.renderedCount = end;
        if (end < this.options.items.length) {
            this.sentinelEl = this.gridEl.createDiv({ cls: 'remote-image-grid-sentinel' });
            this.appendObserver?.observe(this.sentinelEl);
        }
    }

    private renderCard(item: RemoteImageGridItem, index: number): void {
        const { object } = item;
        const card = this.gridEl.createDiv({ cls: 'remote-image-card' });
        card.setAttribute('title', getObjectTitle(object));
        const media = card.createDiv({
            cls: 'remote-image-card-media',
            attr: { role: 'button', tabindex: '0', 'aria-label': t('modal.imageBrowser.remotePreview') },
        });
        const placeholder = media.createDiv({
            cls: 'remote-image-card-placeholder',
            text: item.previewUnavailable
                ? this.options.previewUnavailableMessage(item.previewUnavailable)
                : t('modal.imageBrowser.remoteThumbnailWaiting'),
        });
        if (!item.previewUnavailable && this.options.provider) {
            media.dataset.remoteLoadId = String(index);
            this.thumbnailObserver?.observe(media);
            media.addEventListener('click', () => {
                if (this.options.provider) {
                    this.options.onPreview(this.options.provider, object, item.references);
                }
            });
            media.addEventListener('keydown', (event) => {
                if (event.isComposing || (event.key !== 'Enter' && event.key !== ' ')) return;
                event.preventDefault();
                if (this.options.provider) {
                    this.options.onPreview(this.options.provider, object, item.references);
                }
            });
        } else {
            media.setAttribute('aria-disabled', 'true');
            media.removeAttribute('tabindex');
        }

        if (this.options.deleteEnabled) {
            if (item.deleteUnavailable) {
                if (!isReferencedDeleteReason(item.deleteUnavailable)) {
                    card.createDiv({
                        cls: 'remote-image-card-delete-reason',
                        text: this.options.deleteUnavailableMessage(item.deleteUnavailable),
                    });
                }
            } else {
                const label = card.createEl('label', { cls: 'remote-image-card-select' });
                const checkbox = label.createEl('input', { attr: { type: 'checkbox' } });
                checkbox.checked = this.options.isSelected(object);
                label.createSpan({ text: t('modal.imageBrowser.remoteSelect') });
                checkbox.addEventListener('change', () => {
                    this.options.onSelectionChange(object, checkbox.checked, checkbox);
                    card.toggleClass('is-selected', checkbox.checked);
                });
                card.toggleClass('is-selected', checkbox.checked);
            }
        }

        const reference = card.createDiv({
            cls: `remote-image-card-reference ${referenceClass(item.referenceState)}`,
            text: referenceLabel(item.referenceState),
        });
        reference.setAttribute('title', referenceHint(item.referenceState));
        const filename = getFilename(object.key);
        const name = card.createDiv({ cls: 'remote-image-card-name', text: filename });
        name.setAttribute('title', filename);
        const parent = getParentPath(object.key);
        if (parent) {
            const path = card.createDiv({ cls: 'remote-image-card-path', text: parent });
            path.setAttribute('title', object.key);
        }
        card.createDiv({
            cls: 'remote-image-card-meta',
            text: `${formatFileSize(object.size)} · ${formatModified(object.lastModified)}`,
        });
        placeholder.setAttribute('title', object.key);
    }

    private loadThumbnail(media: HTMLElement, item: RemoteImageGridItem, force = false): void {
        const provider = this.options.provider;
        if (!provider || this.destroyed) return;
        media.empty();
        media.createDiv({ cls: 'remote-image-card-placeholder', text: t('modal.imageBrowser.remoteThumbnailLoading') });
        this.options.thumbnailSession.enqueue(provider, item.object, {
            force,
            onReady: (preview) => {
                if (this.destroyed || !media.isConnected) return;
                media.empty();
                const image = media.createEl('img', { cls: 'remote-image-card-img' });
                image.referrerPolicy = 'no-referrer';
                this.images.add(image);
                image.onload = () => media.addClass('is-loaded');
                image.onerror = () => this.renderLoadError(media, item);
                this.options.onImageRequest();
                image.src = preview.url;
            },
            onError: () => this.renderLoadError(media, item),
        });
    }

    private renderLoadError(media: HTMLElement, item: RemoteImageGridItem): void {
        if (this.destroyed || !media.isConnected) return;
        const previousImage = media.querySelector('img');
        if (previousImage) {
            previousImage.onload = null;
            previousImage.onerror = null;
            previousImage.removeAttribute('src');
            this.images.delete(previousImage);
        }
        media.empty();
        media.createDiv({ cls: 'remote-image-card-placeholder', text: t('modal.imageBrowser.remoteThumbnailFailed') });
        const retry = media.createEl('button', { text: t('modal.remotePreview.retry'), cls: 'remote-image-card-retry' });
        retry.addEventListener('click', (event) => {
            event.stopPropagation();
            this.loadThumbnail(media, item, true);
        });
    }
}

function getFilename(key: string): string {
    return key.split('/').pop() || key;
}

function getParentPath(key: string): string {
    const separator = key.lastIndexOf('/');
    return separator > 0 ? key.slice(0, separator) : '';
}

function formatModified(value: number | undefined): string {
    return value ? new Date(value).toLocaleDateString() : '—';
}

function getObjectTitle(object: RemoteObject): string {
    return [object.key, object.etag ? `ETag: ${object.etag}` : '', object.storageClass ?? '']
        .filter(Boolean)
        .join('\n');
}

function referenceLabel(state: RemoteReferenceState): string {
    const keys: Record<RemoteReferenceState, string> = {
        referenced: 'modal.imageBrowser.remoteReferenced',
        'possibly-referenced': 'modal.imageBrowser.remotePossible',
        'not-referenced-in-current-vault': 'modal.imageBrowser.remoteNotReferenced',
        unmappable: 'modal.imageBrowser.remoteUnmappable',
    };
    return t(keys[state]);
}

function referenceClass(state: RemoteReferenceState): string {
    if (state === 'referenced' || state === 'possibly-referenced') return 'is-referenced';
    if (state === 'not-referenced-in-current-vault') return 'is-orphan';
    return 'is-unmappable';
}

function isReferencedDeleteReason(reason: RemoteDeleteUnavailableReason): boolean {
    return reason === 'referenced' || reason === 'possibly-referenced';
}

function referenceHint(state: RemoteReferenceState): string {
    const keys: Record<RemoteReferenceState, string> = {
        referenced: 'modal.imageBrowser.remoteReferencedHint',
        'possibly-referenced': 'modal.imageBrowser.remotePossibleHint',
        'not-referenced-in-current-vault': 'modal.imageBrowser.remoteNotReferencedHint',
        unmappable: 'modal.imageBrowser.remoteUnmappableHint',
    };
    return t(keys[state]);
}
