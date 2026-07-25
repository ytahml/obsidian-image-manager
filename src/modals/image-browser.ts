import { App, Modal, Notice, TFile } from 'obsidian';
import type ImageManagerPlugin from '../main';
import { ImageScanner } from '../utils/image-scanner';
import { formatFileSize } from '../utils/path-utils';
import {
    getLocalReferenceState,
    scanLocalOrphans,
    trashValidatedLocalOrphans,
    validateLocalOrphanSelection,
} from '../utils/local-orphan-management';
import type { OrphanResult } from '../utils/orphan-finder';
import { t } from '../i18n';
import { ConfirmDialog } from './confirm-dialog';
import { ImagePreviewModal } from './image-preview-modal';
import { RemoteImageBrowserView } from './remote-image-browser';

type LocalScanState = 'scanning' | 'ready' | 'failed';

export class ImageBrowserModal extends Modal {
    private scanner: ImageScanner;
    private allImages: TFile[] = [];
    private filteredImages: TFile[] = [];
    private orphanPaths: Set<string> | null = null;
    private gridEl: HTMLDivElement | null = null;
    private countEl: HTMLSpanElement | null = null;
    private searchInput: HTMLInputElement | null = null;
    private sortSelect: HTMLSelectElement | null = null;
    private orphanBtn: HTMLButtonElement | null = null;
    private deleteSummaryEl: HTMLSpanElement | null = null;
    private deleteButton: HTMLButtonElement | null = null;
    private viewEl: HTMLDivElement | null = null;
    private remoteView: RemoteImageBrowserView | null = null;
    private showOrphansOnly = false;
    private localScanState: LocalScanState = 'scanning';
    private selectedPaths = new Set<string>();
    private localViewVersion = 0;
    private deleting = false;
    private debounceTimer: number | null = null;

    constructor(app: App, private plugin: ImageManagerPlugin) {
        super(app);
        this.scanner = new ImageScanner(app, plugin.settings.supportedExtensions);
    }

    onOpen() {
        this.modalEl.addClass('image-browser-modal');
        this.contentEl.addClass('image-browser');
        const header = this.contentEl.createDiv({ cls: 'image-browser-header' });
        header.createEl('h2', { text: t('modal.imageBrowser.title'), cls: 'image-browser-title' });
        const tabs = header.createDiv({ cls: 'image-browser-tabs' });
        const localTab = tabs.createEl('button', { text: t('modal.imageBrowser.localTab'), cls: 'is-active' });
        const remoteTab = tabs.createEl('button', { text: t('modal.imageBrowser.remoteTab') });
        this.viewEl = this.contentEl.createDiv({ cls: 'image-browser-view' });
        localTab.addEventListener('click', () => {
            localTab.toggleClass('is-active', true);
            remoteTab.toggleClass('is-active', false);
            this.showLocalView();
        });
        remoteTab.addEventListener('click', () => {
            localTab.toggleClass('is-active', false);
            remoteTab.toggleClass('is-active', true);
            this.showRemoteView();
        });
        this.showLocalView();
    }

    onClose() {
        if (this.debounceTimer) window.clearTimeout(this.debounceTimer);
        this.localViewVersion++;
        this.remoteView?.close();
        this.contentEl.empty();
    }

    private showLocalView() {
        const version = ++this.localViewVersion;
        this.remoteView?.close();
        this.remoteView = null;
        this.viewEl?.empty();
        if (!this.viewEl) return;
        this.showOrphansOnly = false;
        this.orphanPaths = null;
        this.localScanState = 'scanning';
        this.deleting = false;
        this.selectedPaths.clear();
        const controls = this.viewEl.createDiv({ cls: 'image-browser-controls' });
        this.searchInput = controls.createEl('input', { cls: 'image-browser-search', attr: { type: 'text', placeholder: t('modal.imageBrowser.searchPlaceholder') } });
        this.searchInput.addEventListener('input', () => this.onSearchInput());
        this.sortSelect = controls.createEl('select', { cls: 'image-browser-sort' });
        for (const option of [
            { value: 'name', labelKey: 'modal.imageBrowser.sortName' },
            { value: 'modified', labelKey: 'modal.imageBrowser.sortModified' },
            { value: 'size', labelKey: 'modal.imageBrowser.sortSize' },
            { value: 'created', labelKey: 'modal.imageBrowser.sortCreated' },
        ]) this.sortSelect.createEl('option', { value: option.value, text: t(option.labelKey) });
        this.sortSelect.addEventListener('change', () => this.applyFilterAndSort());
        this.orphanBtn = controls.createEl('button', { cls: 'image-browser-orphan-btn', text: t('modal.imageBrowser.orphanFilter') });
        this.orphanBtn.disabled = true;
        this.orphanBtn.addEventListener('click', () => this.toggleOrphanFilter());
        this.countEl = controls.createEl('span', { cls: 'image-browser-count' });
        this.gridEl = this.viewEl.createDiv({ cls: 'image-browser-grid' });
        const deleteToolbar = this.viewEl.createDiv({ cls: 'local-image-delete-toolbar' });
        this.deleteSummaryEl = deleteToolbar.createSpan({ cls: 'local-image-delete-summary' });
        this.deleteButton = deleteToolbar.createEl('button', {
            cls: 'mod-warning',
            text: t('modal.imageBrowser.localDeleteSelected'),
        });
        this.deleteButton.addEventListener('click', () => void this.confirmDeleteSelected(version));
        this.allImages = this.scanner.getAllImages();
        this.applyFilterAndSort();
        void this.scanLocalReferenceStates(version);
    }

    private showRemoteView() {
        if (!this.viewEl) return;
        this.localViewVersion++;
        this.viewEl.empty();
        this.remoteView = new RemoteImageBrowserView(
            this.app,
            this.plugin,
            this.viewEl,
            () => this.close()
        );
        this.remoteView.open();
    }

    private onSearchInput() {
        if (this.debounceTimer) window.clearTimeout(this.debounceTimer);
        this.debounceTimer = window.setTimeout(() => this.applyFilterAndSort(), 300);
    }

    private toggleOrphanFilter() {
        if (this.localScanState !== 'ready') return;
        this.showOrphansOnly = !this.showOrphansOnly;
        this.orphanBtn?.toggleClass('is-active', this.showOrphansOnly);
        this.applyFilterAndSort();
    }

    private applyFilterAndSort() {
        const keyword = this.searchInput?.value ?? '';
        let images = this.scanner.filterImages(this.allImages, { keyword });
        if (this.showOrphansOnly && this.orphanPaths) {
            images = images.filter((file) => this.orphanPaths!.has(file.path));
        }
        const sortBy = (this.sortSelect?.value ?? 'name') as 'name' | 'size' | 'modified' | 'created';
        this.filteredImages = this.scanner.sortImages(images, sortBy, 'asc');
        this.renderGrid();
    }

    private renderGrid() {
        if (!this.gridEl) return;
        this.gridEl.empty();
        if (this.countEl) this.countEl.textContent = t('modal.imageBrowser.showing', { count: String(this.filteredImages.length), total: String(this.allImages.length) });
        this.updateDeleteToolbar();
        if (this.filteredImages.length === 0) {
            this.gridEl.createDiv({ cls: 'image-browser-empty', text: t('modal.imageBrowser.noImages') });
            return;
        }
        for (const file of this.filteredImages) {
            const card = this.gridEl.createDiv({ cls: 'image-browser-card' });
            const referenceState = getLocalReferenceState(
                file.path,
                this.orphanPaths,
                this.localScanState
            );
            card.toggleClass('is-selected', this.selectedPaths.has(file.path));
            card.setAttribute('title', `${file.path}\n${t('modal.imageBrowser.insertTooltip')}`);
            const imageContainer = card.createDiv({ cls: 'image-browser-card-img' });
            const image = imageContainer.createEl('img', { attr: { src: this.app.vault.getResourcePath(file) } });
            image.style.width = `${this.plugin.settings.thumbnailSize}px`;
            image.style.height = `${this.plugin.settings.thumbnailSize}px`;
            if (referenceState === 'orphan') {
                const selectLabel = imageContainer.createEl('label', {
                    cls: 'local-image-card-select',
                });
                selectLabel.addEventListener('click', (event) => event.stopPropagation());
                const checkbox = selectLabel.createEl('input', { attr: { type: 'checkbox' } });
                checkbox.checked = this.selectedPaths.has(file.path);
                selectLabel.createSpan({ text: t('modal.imageBrowser.localSelect') });
                checkbox.addEventListener('change', () => {
                    if (checkbox.checked) this.selectedPaths.add(file.path);
                    else this.selectedPaths.delete(file.path);
                    card.toggleClass('is-selected', checkbox.checked);
                    this.updateDeleteToolbar();
                });
            }
            const name = card.createDiv({ cls: 'image-browser-card-name', text: file.name });
            name.setAttribute('title', file.name);
            card.createDiv({
                cls: `local-image-card-reference ${localReferenceClass(referenceState)}`,
                text: localReferenceLabel(referenceState),
            });
            card.createDiv({ cls: 'image-browser-card-meta', text: formatFileSize(file.stat.size) });
            card.addEventListener('click', () => new ImagePreviewModal(this.app, this.plugin, file, this).open());
        }
    }

    private async scanLocalReferenceStates(version: number): Promise<void> {
        this.localScanState = 'scanning';
        this.orphanBtn?.setAttribute('disabled', 'true');
        this.applyFilterAndSort();
        try {
            const result = await scanLocalOrphans(this.app, this.plugin.settings.supportedExtensions);
            if (version !== this.localViewVersion) return;
            this.applyLocalOrphanResult(result);
        } catch (error) {
            if (version !== this.localViewVersion) return;
            this.localScanState = 'failed';
            this.orphanPaths = null;
            this.selectedPaths.clear();
            this.applyFilterAndSort();
            new Notice(t('modal.imageBrowser.localScanFailed'));
            console.error('[ImageManager] Failed to scan local image references:', error);
        }
    }

    private applyLocalOrphanResult(result: OrphanResult): void {
        this.localScanState = 'ready';
        this.orphanPaths = new Set(result.orphans.map((file) => file.path));
        for (const path of this.selectedPaths) {
            if (!this.orphanPaths.has(path)) this.selectedPaths.delete(path);
        }
        if (this.orphanBtn) this.orphanBtn.disabled = false;
        this.applyFilterAndSort();
    }

    private updateDeleteToolbar(): void {
        if (!this.deleteSummaryEl || !this.deleteButton) return;
        const selectedFiles = this.allImages.filter((file) => this.selectedPaths.has(file.path));
        const totalSize = selectedFiles.reduce((sum, file) => sum + file.stat.size, 0);
        this.deleteSummaryEl.textContent = t('modal.imageBrowser.localDeleteSelection', {
            count: String(selectedFiles.length),
            size: formatFileSize(totalSize),
        });
        this.deleteButton.disabled = (
            this.deleting
            || this.localScanState !== 'ready'
            || selectedFiles.length === 0
        );
    }

    private async confirmDeleteSelected(version: number): Promise<void> {
        if (this.deleting || this.selectedPaths.size === 0) {
            if (this.selectedPaths.size === 0) new Notice(t('modal.orphan.noSelection'));
            return;
        }

        this.deleting = true;
        this.updateDeleteToolbar();
        let confirmationOpened = false;
        try {
            const freshResult = await scanLocalOrphans(
                this.app,
                this.plugin.settings.supportedExtensions
            );
            if (version !== this.localViewVersion) return;
            this.applyLocalOrphanResult(freshResult);
            const validation = validateLocalOrphanSelection(this.selectedPaths, freshResult);
            this.selectedPaths = new Set(validation.eligible.map((file) => file.path));
            this.applyFilterAndSort();
            if (validation.eligible.length === 0) {
                new Notice(t('modal.orphan.noSelection'));
                return;
            }

            const totalSize = validation.eligible.reduce((sum, file) => sum + file.stat.size, 0);
            const confirmedPaths = new Set(this.selectedPaths);
            new ConfirmDialog(this.app, {
                title: t('modal.imageBrowser.localDeleteConfirmTitle'),
                message: t('modal.imageBrowser.localDeleteConfirm', {
                    count: String(validation.eligible.length),
                    size: formatFileSize(totalSize),
                }),
                confirmText: t('modal.imageBrowser.localDeleteSelected'),
                pendingText: t('modal.imageBrowser.localDeletePending'),
                onConfirm: async () => {
                    await this.deleteSelected(confirmedPaths, version);
                },
                onCancel: () => {
                    if (version !== this.localViewVersion) return;
                    this.deleting = false;
                    this.updateDeleteToolbar();
                },
            }).open();
            confirmationOpened = true;
        } catch (error) {
            if (version === this.localViewVersion) {
                this.localScanState = 'failed';
                this.orphanPaths = null;
                this.selectedPaths.clear();
                this.applyFilterAndSort();
                new Notice(t('modal.imageBrowser.localScanFailed'));
            }
            console.error('[ImageManager] Failed to revalidate local orphan selection:', error);
        } finally {
            if (!confirmationOpened) {
                this.deleting = false;
                this.updateDeleteToolbar();
            }
        }
    }

    private async deleteSelected(paths: ReadonlySet<string>, version: number): Promise<void> {
        this.deleting = true;
        this.updateDeleteToolbar();
        try {
            const result = await trashValidatedLocalOrphans(
                this.app,
                paths,
                () => scanLocalOrphans(this.app, this.plugin.settings.supportedExtensions)
            );
            new Notice(t('modal.imageBrowser.localDeleteResult', {
                deleted: String(result.deletedPaths.length),
                skipped: String(result.skippedPaths.length),
                failed: String(result.failedPaths.length),
            }));
            if (version !== this.localViewVersion) return;

            this.selectedPaths.clear();
            this.allImages = this.scanner.getAllImages();
            await this.scanLocalReferenceStates(version);
        } catch (error) {
            if (version === this.localViewVersion) {
                this.localScanState = 'failed';
                this.orphanPaths = null;
                this.selectedPaths.clear();
                this.applyFilterAndSort();
                new Notice(t('modal.imageBrowser.localScanFailed'));
            }
            console.error('[ImageManager] Failed to delete local orphan images:', error);
        } finally {
            if (version === this.localViewVersion) {
                this.deleting = false;
                this.updateDeleteToolbar();
            }
        }
    }
}

function localReferenceLabel(state: ReturnType<typeof getLocalReferenceState>): string {
    const keys = {
        scanning: 'modal.imageBrowser.localChecking',
        referenced: 'modal.imageBrowser.localReferenced',
        orphan: 'modal.imageBrowser.localOrphan',
        unknown: 'modal.imageBrowser.localUnknown',
    } as const;
    return t(keys[state]);
}

function localReferenceClass(state: ReturnType<typeof getLocalReferenceState>): string {
    if (state === 'referenced') return 'is-referenced';
    if (state === 'orphan') return 'is-orphan';
    return 'is-unknown';
}
