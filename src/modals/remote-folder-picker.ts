import { App, Modal, Setting, setIcon } from 'obsidian';
import { t } from '../i18n';
import type { RemoteObjectProvider } from '../remote/provider';

const FOLDER_PAGE_SIZE = 200;

/** Explicit, paged browser for S3-style virtual folders. */
export class RemoteFolderPickerModal extends Modal {
    private currentPrefix: string;
    private prefixes: string[] = [];
    private nextCursor: string | undefined;
    private loading = false;
    private closed = false;
    private generation = 0;

    constructor(
        app: App,
        private readonly provider: RemoteObjectProvider,
        initialPrefix: string,
        private readonly bucket: string,
        private readonly onSelect: (prefix: string) => void,
        private readonly onClosed: () => void = () => {}
    ) {
        super(app);
        this.currentPrefix = normalizePrefix(initialPrefix);
    }

    onOpen(): void {
        this.closed = false;
        this.modalEl.addClass('remote-folder-picker-modal');
        this.contentEl.addClass('remote-folder-picker');
        this.render();
        void this.load(false);
    }

    onClose(): void {
        this.closed = true;
        this.generation++;
        this.contentEl.empty();
        this.onClosed();
    }

    private render(): void {
        this.contentEl.empty();
        new Setting(this.contentEl)
            .setName(t('modal.remoteFolder.title'))
            .setDesc(t('modal.remoteFolder.description'))
            .setHeading();

        const scope = this.contentEl.createDiv({ cls: 'remote-folder-picker-scope' });
        scope.createSpan({ text: t('modal.remoteFolder.bucket', { bucket: this.bucket }) });
        this.renderBreadcrumb(scope);

        const list = this.contentEl.createDiv({ cls: 'remote-folder-picker-list' });
        this.contentEl.setAttribute('aria-busy', String(this.loading));
        if (this.prefixes.length === 0 && !this.loading && !this.nextCursor) {
            list.createDiv({
                cls: 'remote-folder-picker-empty',
                text: t('modal.remoteFolder.empty'),
            });
        }
        for (const prefix of this.prefixes) {
            const button = list.createEl('button', { cls: 'remote-folder-picker-item' });
            const icon = button.createSpan({ cls: 'remote-folder-picker-icon' });
            setIcon(icon, 'folder');
            button.createSpan({ text: getFolderName(prefix, this.currentPrefix) });
            button.addEventListener('click', () => this.navigate(prefix));
        }
        if (this.loading) {
            const status = list.createDiv({
                cls: 'remote-folder-picker-loading',
                attr: { role: 'status', 'aria-live': 'polite' },
            });
            status.createDiv({ cls: 'remote-image-browser-spinner' });
            status.createSpan({ text: t('modal.remoteFolder.loading') });
        } else if (this.nextCursor) {
            const more = list.createEl('button', {
                cls: 'remote-folder-picker-more',
                text: t('modal.remoteFolder.loadMore'),
            });
            more.addEventListener('click', () => void this.load(true));
        }

        const actions = this.contentEl.createDiv({ cls: 'remote-folder-picker-actions' });
        const cancel = actions.createEl('button', { text: t('modal.confirm.cancel') });
        cancel.addEventListener('click', () => this.close());
        const select = actions.createEl('button', {
            cls: 'mod-cta',
            text: t('modal.remoteFolder.selectCurrent'),
        });
        select.addEventListener('click', () => {
            this.onSelect(this.currentPrefix);
            this.close();
        });
    }

    private renderBreadcrumb(container: HTMLElement): void {
        const breadcrumb = container.createDiv({ cls: 'remote-folder-picker-breadcrumb' });
        const root = breadcrumb.createEl('button', { text: t('modal.remoteFolder.root') });
        root.disabled = this.currentPrefix === '';
        root.addEventListener('click', () => this.navigate(''));
        const segments = this.currentPrefix.split('/').filter(Boolean);
        let path = '';
        for (const segment of segments) {
            breadcrumb.createSpan({ cls: 'remote-folder-picker-separator', text: '/' });
            path = path ? `${path}/${segment}` : segment;
            const prefix = path;
            const button = breadcrumb.createEl('button', { text: segment });
            button.disabled = prefix === this.currentPrefix;
            button.addEventListener('click', () => this.navigate(prefix));
        }
    }

    private navigate(prefix: string): void {
        if (this.loading || prefix === this.currentPrefix) return;
        this.generation++;
        this.currentPrefix = normalizePrefix(prefix);
        this.prefixes = [];
        this.nextCursor = undefined;
        this.render();
        void this.load(false);
    }

    private async load(append: boolean): Promise<void> {
        if (this.loading || !this.provider.listFolders) return;
        const generation = ++this.generation;
        const cursor = append ? this.nextCursor : undefined;
        this.loading = true;
        this.render();
        try {
            const page = await this.provider.listFolders({
                prefix: this.currentPrefix,
                ...(cursor ? { cursor } : {}),
                limit: FOLDER_PAGE_SIZE,
            });
            if (this.closed || generation !== this.generation) return;
            this.prefixes = append
                ? [...new Set([...this.prefixes, ...page.prefixes])]
                : page.prefixes;
            this.nextCursor = page.isTruncated ? page.nextCursor : undefined;
        } catch {
            if (this.closed || generation !== this.generation) return;
            this.loading = false;
            this.renderError();
            return;
        }
        if (this.closed || generation !== this.generation) return;
        this.loading = false;
        this.render();
    }

    private renderError(): void {
        this.contentEl.empty();
        new Setting(this.contentEl)
            .setName(t('modal.remoteFolder.title'))
            .setHeading();
        this.contentEl.createDiv({
            cls: 'remote-folder-picker-error mod-warning',
            text: t('modal.remoteFolder.error'),
        });
        const actions = this.contentEl.createDiv({ cls: 'remote-folder-picker-actions' });
        const cancel = actions.createEl('button', { text: t('modal.confirm.cancel') });
        cancel.addEventListener('click', () => this.close());
        const retry = actions.createEl('button', {
            cls: 'mod-cta',
            text: t('modal.remoteFolder.retry'),
        });
        retry.addEventListener('click', () => {
            this.prefixes = [];
            this.nextCursor = undefined;
            this.render();
            void this.load(false);
        });
    }
}

function normalizePrefix(prefix: string): string {
    return prefix.trim().replace(/^\/+|\/+$/g, '');
}

function getFolderName(prefix: string, parent: string): string {
    const base = parent ? `${parent}/` : '';
    return prefix.startsWith(base) ? prefix.slice(base.length) : prefix;
}
