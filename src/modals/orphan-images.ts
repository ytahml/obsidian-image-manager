import { App, Modal, Notice, TFile } from 'obsidian';
import type ImageManagerPlugin from '../main';
import { OrphanFinder } from '../utils/orphan-finder';
import { formatFileSize } from '../utils/path-utils';
import { ConfirmDialog } from './confirm-dialog';
import { t } from '../i18n';

export class OrphanImagesModal extends Modal {
    private plugin: ImageManagerPlugin;
    private orphans: TFile[] = [];
    private selected: Set<string> = new Set();
    private listEl: HTMLDivElement | null = null;

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
        const finder = new OrphanFinder(this.app, this.plugin.settings.supportedExtensions);
        const result = await finder.findOrphans();
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
        controls.createEl('span', {
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
        deleteBtn.addEventListener('click', () => this.confirmDelete());
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
    }

    private confirmDelete() {
        if (this.selected.size === 0) {
            new Notice(t('modal.orphan.noSelection'));
            return;
        }

        new ConfirmDialog(this.app, {
            title: t('modal.orphan.deleteConfirmTitle'),
            message: t('modal.orphan.deleteConfirmMsg', { count: String(this.selected.size) }),
            confirmText: t('modal.confirm.ok'),
            cancelText: t('modal.confirm.cancel'),
            onConfirm: async () => {
                await this.deleteSelected();
            },
        }).open();
    }

    private async deleteSelected() {
        let deleted = 0;
        for (const file of this.orphans) {
            if (this.selected.has(file.path)) {
                try {
                    await this.app.vault.delete(file);
                    deleted++;
                } catch (e) {
                    console.error(`Failed to delete ${file.path}:`, e);
                }
            }
        }

        new Notice(t('modal.orphan.deleted', { count: String(deleted) }));

        // Refresh
        this.orphans = this.orphans.filter((f) => !this.selected.has(f.path));
        this.selected.clear();

        if (this.orphans.length === 0) {
            this.close();
        } else {
            this.renderList();
        }
    }
}
