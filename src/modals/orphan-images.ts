import { App, Modal, Notice, TFile } from 'obsidian';
import type ImageManagerPlugin from '../main';
import {
    scanLocalOrphans,
    trashValidatedLocalOrphans,
    validateLocalOrphanSelection,
} from '../utils/local-orphan-management';
import { formatFileSize } from '../utils/path-utils';
import { ConfirmDialog } from './confirm-dialog';
import { t } from '../i18n';

export class OrphanImagesModal extends Modal {
    private plugin: ImageManagerPlugin;
    private orphans: TFile[] = [];
    private selected: Set<string> = new Set();
    private listEl: HTMLDivElement | null = null;
    private sizeEl: HTMLSpanElement | null = null;

    constructor(app: App, plugin: ImageManagerPlugin) {
        super(app);
        this.plugin = plugin;
    }

    async onOpen() {
        const { contentEl } = this;
        contentEl.addClass('orphan-images');

        contentEl.createEl('h2', { text: t('modal.orphan.title') });
        contentEl.createEl('p', {
            text: t('modal.orphan.scanning'),
            cls: 'orphan-images-status',
        });

        // Scan for orphans
        const result = await this.scanProtectedOrphans();
        this.orphans = result.orphans;

        // Update status
        const statusEl = contentEl.querySelector('.orphan-images-status');
        if (statusEl) {
            statusEl.textContent = t('modal.orphan.status', {
                orphan: String(result.orphans.length),
                total: String(result.total),
                referenced: String(result.referenced),
            });
        }

        if (this.orphans.length === 0) {
            contentEl.createDiv({
                cls: 'orphan-images-empty',
                text: t('modal.orphan.noOrphans'),
            });
            return;
        }

        // Select all / none
        const controls = contentEl.createDiv({ cls: 'orphan-images-controls' });
        const selectAllBtn = controls.createEl('button', {
            text: t('modal.orphan.selectAll'),
            cls: 'orphan-images-btn',
        });
        selectAllBtn.addEventListener('click', () => {
            this.orphans.forEach((f) => this.selected.add(f.path));
            this.renderList();
        });

        const selectNoneBtn = controls.createEl('button', {
            text: t('modal.orphan.selectNone'),
            cls: 'orphan-images-btn',
        });
        selectNoneBtn.addEventListener('click', () => {
            this.selected.clear();
            this.renderList();
        });

        const totalSize = this.orphans.reduce((sum, f) => sum + f.stat.size, 0);
        this.sizeEl = controls.createSpan({
            text: t('modal.orphan.totalSize', { size: formatFileSize(totalSize) }),
            cls: 'orphan-images-size',
        });

        // List
        this.listEl = contentEl.createDiv({ cls: 'orphan-images-list' });
        this.renderList();

        // Delete button
        const footer = contentEl.createDiv({ cls: 'orphan-images-footer' });
        const deleteBtn = footer.createEl('button', {
            text: t('modal.orphan.deleteSelected'),
            cls: 'mod-warning',
        });
        deleteBtn.addEventListener('click', () => void this.confirmDelete());
    }

    onClose() {
        this.contentEl.empty();
    }

    private renderList() {
        if (!this.listEl) return;
        this.listEl.empty();

        for (const file of this.orphans) {
            const row = this.listEl.createDiv({ cls: 'orphan-images-item' });

            const checkbox = row.createEl('input', { attr: { type: 'checkbox' } });
            checkbox.checked = this.selected.has(file.path);
            checkbox.addEventListener('change', () => {
                if (checkbox.checked) {
                    this.selected.add(file.path);
                } else {
                    this.selected.delete(file.path);
                }
            });

            row.createDiv({ cls: 'orphan-images-item-name', text: file.name });
            row.createDiv({ cls: 'orphan-images-item-path', text: file.path });
            row.createDiv({
                cls: 'orphan-images-item-size',
                text: formatFileSize(file.stat.size),
            });
        }
        if (this.sizeEl) {
            const totalSize = this.orphans.reduce((sum, file) => sum + file.stat.size, 0);
            this.sizeEl.textContent = t('modal.orphan.totalSize', {
                size: formatFileSize(totalSize),
            });
        }
    }

    private async confirmDelete() {
        if (this.selected.size === 0) {
            new Notice(t('modal.orphan.noSelection'));
            return;
        }

        try {
            const freshResult = await this.scanProtectedOrphans();
            const validation = validateLocalOrphanSelection(this.selected, freshResult);
            this.orphans = freshResult.orphans;
            this.selected = new Set(validation.eligible.map((file) => file.path));
            this.renderList();
            if (validation.eligible.length === 0) {
                new Notice(t('modal.orphan.noSelection'));
                return;
            }

            const totalSize = validation.eligible.reduce((sum, file) => sum + file.stat.size, 0);
            const confirmedPaths = new Set(this.selected);
            new ConfirmDialog(this.app, {
                title: t('modal.orphan.deleteConfirmTitle'),
                message: t('modal.orphan.deleteConfirmMsg', {
                    count: String(validation.eligible.length),
                    size: formatFileSize(totalSize),
                }),
                confirmText: t('modal.orphan.deleteSelected'),
                pendingText: t('modal.imageBrowser.localDeletePending'),
                cancelText: t('modal.confirm.cancel'),
                onConfirm: async () => {
                    await this.deleteSelected(confirmedPaths);
                },
            }).open();
        } catch (error) {
            new Notice(t('modal.imageBrowser.localScanFailed'));
            console.error('[ImageManager] Failed to revalidate orphan image selection:', error);
        }
    }

    private async deleteSelected(paths: ReadonlySet<string>) {
        const result = await trashValidatedLocalOrphans(
            this.app,
            paths,
            () => this.scanProtectedOrphans()
        );
        new Notice(t('modal.orphan.deleted', {
            deleted: String(result.deletedPaths.length),
            skipped: String(result.skippedPaths.length),
            failed: String(result.failedPaths.length),
        }));

        const refreshed = await this.scanProtectedOrphans();
        this.orphans = refreshed.orphans;
        this.selected.clear();

        if (this.orphans.length === 0) {
            this.close();
        } else {
            this.renderList();
        }
    }

    private scanProtectedOrphans() {
        return scanLocalOrphans(
            this.app,
            this.plugin.settings.supportedExtensions,
            new Map(),
            this.plugin.getIndeterminateImagePaths()
        );
    }
}
