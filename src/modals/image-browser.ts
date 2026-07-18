import { App, Modal, Notice, TFile } from 'obsidian';
import type ImageManagerPlugin from '../main';
import { ImageScanner } from '../utils/image-scanner';
import { OrphanFinder } from '../utils/orphan-finder';
import { formatFileSize } from '../utils/path-utils';
import { t } from '../i18n';
import { ImagePreviewModal } from './image-preview-modal';
import { RemoteImageBrowserView } from './remote-image-browser';

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
    private viewEl: HTMLDivElement | null = null;
    private remoteView: RemoteImageBrowserView | null = null;
    private showOrphansOnly = false;
    private debounceTimer: number | null = null;

    constructor(app: App, private plugin: ImageManagerPlugin) {
        super(app);
        this.scanner = new ImageScanner(app, plugin.settings.supportedExtensions);
    }

    onOpen() {
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
        this.remoteView?.close();
        this.contentEl.empty();
    }

    private showLocalView() {
        this.remoteView?.close();
        this.remoteView = null;
        this.viewEl?.empty();
        if (!this.viewEl) return;
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
        this.orphanBtn.addEventListener('click', () => void this.toggleOrphanFilter());
        this.countEl = controls.createEl('span', { cls: 'image-browser-count' });
        this.gridEl = this.viewEl.createDiv({ cls: 'image-browser-grid' });
        this.allImages = this.scanner.getAllImages();
        this.applyFilterAndSort();
    }

    private showRemoteView() {
        if (!this.viewEl) return;
        this.viewEl.empty();
        this.remoteView = new RemoteImageBrowserView(this.app, this.plugin, this.viewEl);
        this.remoteView.open();
    }

    private onSearchInput() {
        if (this.debounceTimer) window.clearTimeout(this.debounceTimer);
        this.debounceTimer = window.setTimeout(() => this.applyFilterAndSort(), 300);
    }

    private async toggleOrphanFilter() {
        this.showOrphansOnly = !this.showOrphansOnly;
        this.orphanBtn?.toggleClass('is-active', this.showOrphansOnly);
        if (this.showOrphansOnly) {
            new Notice(t('modal.imageBrowser.orphanScanning'));
            const finder = new OrphanFinder(this.app, this.plugin.settings.supportedExtensions);
            const result = await finder.findOrphans();
            this.orphanPaths = new Set(result.orphans.map((file) => file.path));
        } else this.orphanPaths = null;
        this.applyFilterAndSort();
    }

    private applyFilterAndSort() {
        const keyword = this.searchInput?.value ?? '';
        let images = this.scanner.filterImages(this.allImages, { keyword });
        if (this.showOrphansOnly && this.orphanPaths) images = images.filter((file) => this.orphanPaths!.has(file.path));
        const sortBy = (this.sortSelect?.value ?? 'name') as 'name' | 'size' | 'modified' | 'created';
        this.filteredImages = this.scanner.sortImages(images, sortBy, 'asc');
        this.renderGrid();
    }

    private renderGrid() {
        if (!this.gridEl) return;
        this.gridEl.empty();
        if (this.countEl) this.countEl.textContent = t('modal.imageBrowser.showing', { count: String(this.filteredImages.length), total: String(this.allImages.length) });
        if (this.filteredImages.length === 0) {
            this.gridEl.createDiv({ cls: 'image-browser-empty', text: t('modal.imageBrowser.noImages') });
            return;
        }
        for (const file of this.filteredImages) {
            const card = this.gridEl.createDiv({ cls: 'image-browser-card' });
            card.setAttribute('title', `${file.path}\n${t('modal.imageBrowser.insertTooltip')}`);
            const imageContainer = card.createDiv({ cls: 'image-browser-card-img' });
            const image = imageContainer.createEl('img', { attr: { src: this.app.vault.getResourcePath(file) } });
            image.style.width = `${this.plugin.settings.thumbnailSize}px`;
            image.style.height = `${this.plugin.settings.thumbnailSize}px`;
            const name = card.createDiv({ cls: 'image-browser-card-name', text: file.name });
            name.setAttribute('title', file.name);
            card.createDiv({ cls: 'image-browser-card-meta', text: formatFileSize(file.stat.size) });
            card.addEventListener('click', () => new ImagePreviewModal(this.app, this.plugin, file, this).open());
        }
    }
}
