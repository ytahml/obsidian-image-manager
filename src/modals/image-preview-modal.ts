import { App, Modal, Notice, TFile, SuggestModal, MarkdownView } from 'obsidian';
import type ImageManagerPlugin from '../main';
import type { ImageHostingConfig } from '../types';
import { OrphanFinder } from '../utils/orphan-finder';
import { encodePathSegments, formatFileSize } from '../utils/path-utils';
import { RenameImageModal } from './rename-image';
import { t } from '../i18n';

export class ImagePreviewModal extends Modal {
    private file: TFile;
    private plugin: ImageManagerPlugin;
    private browserModal?: Modal;

    constructor(app: App, plugin: ImageManagerPlugin, file: TFile, browserModal?: Modal) {
        super(app);
        this.plugin = plugin;
        this.file = file;
        this.browserModal = browserModal;
    }

    async onOpen() {
        const { contentEl } = this;
        contentEl.addClass('image-preview');

        // Image preview
        contentEl.createEl('img', {
            cls: 'image-preview-img',
            attr: { src: this.app.vault.getResourcePath(this.file) },
        });

        // File info section
        const infoEl = contentEl.createDiv({ cls: 'image-preview-info' });

        // Path
        const pathRow = infoEl.createDiv({ cls: 'image-preview-path' });
        pathRow.createSpan({ cls: 'image-preview-label', text: t('modal.preview.path') });
        pathRow.createSpan({ text: this.file.path });

        // Size
        const sizeRow = infoEl.createDiv({ cls: 'image-preview-meta' });
        sizeRow.createSpan({ cls: 'image-preview-label', text: t('modal.preview.size') });
        sizeRow.createSpan({ text: formatFileSize(this.file.stat.size) });

        // Image dimensions (load to get size)
        const dimensions = await this.getImageDimensions(this.file);
        if (dimensions) {
            sizeRow.createSpan({ text: ` | ${dimensions.width}×${dimensions.height}` });
        }

        // Referencing notes
        const finder = new OrphanFinder(this.app, this.plugin.settings.supportedExtensions);
        const notes = await finder.getReferencingNotes(this.file);
        const totalRefs = notes.reduce((sum, n) => sum + n.lines.length, 0);

        const refRow = infoEl.createDiv({ cls: 'image-preview-meta' });
        refRow.createSpan({ cls: 'image-preview-label', text: t('modal.preview.references') });
        if (notes.length === 0) {
            refRow.createSpan({ cls: 'image-preview-orphan', text: t('modal.preview.orphan') });
        } else {
            refRow.createSpan({
                text: t('modal.preview.refCount', {
                    total: String(totalRefs),
                    notes: String(notes.length),
                }),
            });

            // Expandable details
            const detailsToggle = refRow.createSpan({
                cls: 'image-preview-details-toggle',
                text: ' ▾',
            });
            const notesList = infoEl.createDiv({ cls: 'image-preview-notes' });
            let expanded = true;

            detailsToggle.addEventListener('click', () => {
                expanded = !expanded;
                detailsToggle.setText(expanded ? ' ▾' : ' ▸');
                notesList.toggleClass('image-preview-notes-hidden', !expanded);
            });

            for (const note of notes) {
                const noteRow = notesList.createDiv({ cls: 'image-preview-note-item' });
                noteRow.createSpan({ cls: 'image-preview-note-path', text: note.path });
                const linesSpan = noteRow.createSpan({ cls: 'image-preview-note-lines' });
                for (const line of note.lines) {
                    const lineLink = linesSpan.createSpan({
                        cls: 'image-preview-note-line-link',
                        text: `:${line + 1}`,
                    });
                    lineLink.addEventListener('click', () => {
                        this.close();
                        this.browserModal?.close();
                        void this.app.workspace.openLinkText(note.path, note.path, true).then(() => {
                            const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
                            if (activeView) {
                                activeView.editor.setCursor(line);
                                activeView.editor.scrollIntoView(
                                    { from: { line, ch: 0 }, to: { line, ch: 0 } },
                                    true
                                );
                            }
                        });
                    });
                }
            }
        }

        // Action buttons
        const btnsEl = contentEl.createDiv({ cls: 'image-preview-buttons' });

        // Copy reference
        const copyBtn = btnsEl.createEl('button', { text: t('modal.preview.copyRef'), cls: 'mod-cta' });
        copyBtn.addEventListener('click', () => void this.copyReference());

        // Insert into editor
        const insertBtn = btnsEl.createEl('button', { text: t('modal.preview.insert') });
        insertBtn.addEventListener('click', () => this.insertImage());

        // Upload to hosting
        const configs = this.plugin.settings.hostingConfigs.filter((c) => c.enabled);
        if (configs.length > 0) {
            const uploadBtn = btnsEl.createEl('button', { text: t('modal.preview.upload') });
            uploadBtn.addEventListener('click', () => void this.uploadImage(configs));
        }

        // Rename
        const renameBtn = btnsEl.createEl('button', { text: t('modal.preview.rename') });
        renameBtn.addEventListener('click', () => void this.renameImage());

        // Close
        const closeBtn = btnsEl.createEl('button', { text: t('modal.preview.close') });
        closeBtn.addEventListener('click', () => this.close());
    }

    onClose() {
        this.contentEl.empty();
    }

    private buildReference(): string {
        return `![${this.file.name}](${encodePathSegments(this.file.path)})`;
    }

    private async copyReference() {
        const ref = this.buildReference();
        await navigator.clipboard.writeText(ref);
        new Notice(t('notice.refCopied'));
    }

    private insertImage() {
        const editor = this.app.workspace.activeEditor?.editor;
        if (!editor) {
            new Notice(t('notice.noActiveEditor'));
            return;
        }

        editor.replaceSelection(this.buildReference());
        new Notice(t('notice.imageInserted'));
        this.close();
    }

    private async uploadImage(configs: ImageHostingConfig[]) {
        const doUpload = async (config: ImageHostingConfig) => {
            this.close();
            this.browserModal?.close();
            await this.plugin.doUpload(this.file, config);
        };

        if (configs.length === 1) {
            await doUpload(configs[0]!);
        } else {
            new HostingPickModal(this.app, configs, (config) => {
                void doUpload(config);
            }).open();
        }
    }

    private renameImage() {
        new RenameImageModal(this.app, this.file, (newName) => {
            void (async () => {
                try {
                    const result = await this.plugin.batchRename.renameImage(this.file, newName);
                    this.file = result.file;
                    new Notice(
                        t('notice.renameSuccess', {
                            old: result.oldName,
                            new: result.newName,
                            notes: String(result.notesUpdated),
                        })
                    );
                    this.contentEl.empty();
                    await this.onOpen();
                } catch (e) {
                    new Notice(t('notice.renameFailed', { error: e instanceof Error ? e.message : 'Unknown error' }));
                }
            })();
        }).open();
    }

    private getImageDimensions(file: TFile): Promise<{ width: number; height: number } | null> {
        return new Promise((resolve) => {
            const img = new Image();
            img.onload = () => {
                resolve({ width: img.naturalWidth, height: img.naturalHeight });
                URL.revokeObjectURL(img.src);
            };
            img.onerror = () => resolve(null);
            img.src = this.app.vault.getResourcePath(file);
        });
    }
}

class HostingPickModal extends SuggestModal<ImageHostingConfig> {
    private configs: ImageHostingConfig[];
    private onChoose: (config: ImageHostingConfig) => void;

    constructor(app: App, configs: ImageHostingConfig[], onChoose: (config: ImageHostingConfig) => void) {
        super(app);
        this.configs = configs;
        this.onChoose = onChoose;
    }

    getSuggestions(query: string): ImageHostingConfig[] {
        return this.configs.filter(
            (c) => c.name.toLowerCase().includes(query.toLowerCase()) || c.type.includes(query.toLowerCase())
        );
    }

    renderSuggestion(config: ImageHostingConfig, el: HTMLElement) {
        el.createDiv({ text: config.name });
        el.createDiv({ text: config.type, cls: 'suggestion-note' });
    }

    onChooseItem(config: ImageHostingConfig) {
        this.onChoose(config);
    }

    onChooseSuggestion(config: ImageHostingConfig) {
        this.onChoose(config);
    }
}
