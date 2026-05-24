import { App, Modal, Notice, TFile } from 'obsidian';
import type ImageManagerPlugin from '../main';
import { ImageScanner } from '../utils/image-scanner';
import { OrphanFinder } from '../utils/orphan-finder';
import { formatFileSize } from '../utils/path-utils';
import { t } from '../i18n';
import { ImagePreviewModal } from './image-preview-modal';

export class ImageBrowserModal extends Modal {
    private plugin: ImageManagerPlugin;
    private scanner: ImageScanner;
    private allImages: TFile[] = [];
    private filteredImages: TFile[] = [];
    private orphanPaths: Set<string> | null = null;
    private gridEl: HTMLDivElement | null = null;
    private countEl: HTMLSpanElement | null = null;
    private searchInput: HTMLInputElement | null = null;
    private sortSelect: HTMLSelectElement | null = null;
    private orphanBtn: HTMLButtonElement | null = null;
    private showOrphansOnly = false;
    private debounceTimer: ReturnType<typeof setTimeout> | null = null;

    constructor(app: App, plugin: ImageManagerPlugin) {
        super(app);
        this.plugin = plugin;
        this.scanner = new ImageScanner(app, plugin.settings.supportedExtensions);
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.addClass('image-browser');

        // Header
        const header = contentEl.createDiv({ cls: 'image-browser-header' });
        header.createEl('h2', { text: t('modal.imageBrowser.title'), cls: 'image-browser-title' });

        // Controls row
        const controls = contentEl.createDiv({ cls: 'image-browser-controls' });

        // Search
        this.searchInput = controls.createEl('input', {
            cls: 'image-browser-search',
            attr: {
                type: 'text',
                placeholder: t('modal.imageBrowser.searchPlaceholder'),
            },
        });
        this.searchInput.addEventListener('input', () => this.onSearchInput());

        // Sort
        this.sortSelect = controls.createEl('select', { cls: 'image-browser-sort' });
        const sortOptions: Array<{ value: string; labelKey: string }> = [
            { value: 'name', labelKey: 'modal.imageBrowser.sortName' },
            { value: 'modified', labelKey: 'modal.imageBrowser.sortModified' },
            { value: 'size', labelKey: 'modal.imageBrowser.sortSize' },
            { value: 'created', labelKey: 'modal.imageBrowser.sortCreated' },
        ];
        for (const opt of sortOptions) {
            this.sortSelect.createEl('option', { value: opt.value, text: t(opt.labelKey) });
        }
        this.sortSelect.addEventListener('change', () => this.onSortChange());

        // Orphan filter
        this.orphanBtn = controls.createEl('button', {
            cls: 'image-browser-orphan-btn',
            text: t('modal.imageBrowser.orphanFilter'),
        });
        this.orphanBtn.addEventListener('click', () => this.toggleOrphanFilter());

        // Count
        this.countEl = controls.createEl('span', { cls: 'image-browser-count' });

        // Grid
        this.gridEl = contentEl.createDiv({ cls: 'image-browser-grid' });

        // Load and render
        this.loadImages();
    }

    onClose() {
        if (this.debounceTimer) clearTimeout(this.debounceTimer);
        this.contentEl.empty();
    }

    private loadImages() {
        this.allImages = this.scanner.getAllImages();
        this.applyFilterAndSort();
    }

    private onSearchInput() {
        if (this.debounceTimer) clearTimeout(this.debounceTimer);
        this.debounceTimer = setTimeout(() => this.applyFilterAndSort(), 300);
    }

    private onSortChange() {
        this.applyFilterAndSort();
    }

    private async toggleOrphanFilter() {
        this.showOrphansOnly = !this.showOrphansOnly;

        if (this.orphanBtn) {
            this.orphanBtn.toggleClass('is-active', this.showOrphansOnly);
        }

        if (this.showOrphansOnly) {
            new Notice(t('modal.imageBrowser.orphanScanning'));
            const finder = new OrphanFinder(this.app, this.plugin.settings.supportedExtensions);
            const result = await finder.findOrphans();
            this.orphanPaths = new Set(result.orphans.map((f) => f.path));
        } else {
            this.orphanPaths = null;
        }

        this.applyFilterAndSort();
    }

    private applyFilterAndSort() {
        const keyword = this.searchInput?.value ?? '';

        // Filter
        let images = this.scanner.filterImages(this.allImages, { keyword });

        // Orphan filter
        if (this.showOrphansOnly && this.orphanPaths) {
            images = images.filter((f) => this.orphanPaths!.has(f.path));
        }

        // Sort
        const sortBy = (this.sortSelect?.value ?? 'name') as 'name' | 'size' | 'modified' | 'created';
        this.filteredImages = this.scanner.sortImages(images, sortBy, 'asc');

        this.renderGrid();
    }

    private renderGrid() {
        if (!this.gridEl) return;
        this.gridEl.empty();

        // Update count
        if (this.countEl) {
            this.countEl.textContent = t('modal.imageBrowser.showing', {
                count: String(this.filteredImages.length),
                total: String(this.allImages.length),
            });
        }

        if (this.filteredImages.length === 0) {
            this.gridEl.createDiv({
                cls: 'image-browser-empty',
                text: t('modal.imageBrowser.noImages'),
            });
            return;
        }

        const thumbSize = this.plugin.settings.thumbnailSize;

        for (const file of this.filteredImages) {
            const card = this.gridEl.createDiv({ cls: 'image-browser-card' });
            card.setAttribute('title', `${file.path}\n${t('modal.imageBrowser.insertTooltip')}`);

            const imgContainer = card.createDiv({ cls: 'image-browser-card-img' });
            const img = imgContainer.createEl('img', {
                attr: { src: this.app.vault.getResourcePath(file) },
            });
            img.style.width = `${thumbSize}px`;
            img.style.height = `${thumbSize}px`;

            const nameEl = card.createDiv({ cls: 'image-browser-card-name', text: file.name });
            nameEl.setAttribute('title', file.name);

            card.createDiv({
                cls: 'image-browser-card-meta',
                text: formatFileSize(file.stat.size),
            });

            card.addEventListener('click', () => {
                new ImagePreviewModal(this.app, this.plugin, file, this).open();
            });
        }
    }
}
