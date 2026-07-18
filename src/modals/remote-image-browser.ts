import { App } from 'obsidian';
import type ImageManagerPlugin from '../main';
import type { ImageHostingConfig } from '../types';
import { t } from '../i18n';
import { formatFileSize } from '../utils/path-utils';
import { ConfirmDialog } from './confirm-dialog';
import { RemoteBrowseSession } from '../remote/browse-session';
import { getRemoteManagementConfig, normalizeRemotePageSize, normalizeRemotePrefix } from '../remote/management-settings';
import { createRemoteObjectProvider } from '../remote/provider-factory';
import type { RemoteObject, RemoteReferenceState, RemoteUrlMapping } from '../remote/types';

/** Metadata-only browser view. It must never create remote image elements. */
export class RemoteImageBrowserView {
    private session = new RemoteBrowseSession();
    private selectedHostingId = '';
    private emptyPrefixConfirmed = new Set<string>();
    private scanAbortController: AbortController | null = null;
    private keyword = '';
    private sortBy: 'key' | 'size' | 'modified' = 'key';

    constructor(
        private app: App,
        private plugin: ImageManagerPlugin,
        private containerEl: HTMLElement
    ) {}

    open() {
        const configs = this.getConfigs();
        if (!configs.some((config) => config.id === this.selectedHostingId)) {
            this.selectedHostingId = configs[0]?.id ?? '';
        }
        this.render();
    }

    close() {
        this.scanAbortController?.abort();
        this.scanAbortController = null;
        this.session.stop();
        this.containerEl.empty();
    }

    private getConfigs(): ImageHostingConfig[] {
        return this.plugin.settings.hostingConfigs.filter(
            (config) => config.enabled && getRemoteManagementConfig(config).enabled
        );
    }

    private getSelectedConfig(): ImageHostingConfig | undefined {
        return this.getConfigs().find((config) => config.id === this.selectedHostingId);
    }

    private render() {
        this.containerEl.empty();
        this.containerEl.addClass('remote-image-browser');
        const configs = this.getConfigs();
        if (configs.length === 0) {
            this.containerEl.createDiv({ cls: 'image-browser-empty', text: t('modal.imageBrowser.remoteNoConfig') });
            return;
        }

        const config = this.getSelectedConfig()!;
        const settings = getRemoteManagementConfig(config);
        const providerResult = createRemoteObjectProvider(config);
        const controls = this.containerEl.createDiv({ cls: 'remote-image-browser-controls' });

        controls.createSpan({ text: `${t('modal.imageBrowser.remoteProvider')}:` });
        const configSelect = controls.createEl('select');
        for (const item of configs) {
            configSelect.createEl('option', { value: item.id, text: item.name || item.type.toUpperCase() });
        }
        configSelect.value = config.id;
        configSelect.addEventListener('change', () => {
            this.selectedHostingId = configSelect.value;
            this.emptyPrefixConfirmed.clear();
            this.session.invalidate();
            this.render();
        });

        const prefixInput = controls.createEl('input', {
            attr: { type: 'text', placeholder: t('modal.imageBrowser.remotePrefix') },
            value: settings.prefix,
        });
        prefixInput.addEventListener('change', () => {
            void this.updateConfig(config, (current) => {
                current.prefix = normalizeRemotePrefix(prefixInput.value);
            });
        });

        const pageSizeInput = controls.createEl('input', {
            attr: { type: 'number', min: '1', max: '1000', title: t('modal.imageBrowser.remotePageSize') },
            value: String(settings.pageSize),
        });
        pageSizeInput.addEventListener('change', () => {
            void this.updateConfig(config, (current) => {
                current.pageSize = normalizeRemotePageSize(Number(pageSizeInput.value));
            });
        });

        this.containerEl.createDiv({
            cls: 'remote-image-browser-range',
            text: t('modal.imageBrowser.remoteRange', { scope: getScope(config, settings.prefix) }),
        });

        if (providerResult.status === 'unsupported' || !providerResult.provider.capabilities.has('list')) {
            this.containerEl.createDiv({ cls: 'remote-image-browser-message', text: t('modal.imageBrowser.remoteUnsupported') });
            return;
        }

        const actions = this.containerEl.createDiv({ cls: 'remote-image-browser-actions' });
        const snapshot = this.session.getSnapshot();
        const scanButton = actions.createEl('button', { text: t('modal.imageBrowser.remoteScan'), cls: 'mod-cta' });
        scanButton.disabled = snapshot.status === 'scanning';
        scanButton.addEventListener('click', () => void this.startScan(config));

        const refreshButton = actions.createEl('button', { text: t('modal.imageBrowser.remoteRefresh') });
        refreshButton.disabled = snapshot.status === 'scanning' || snapshot.pages.length === 0;
        refreshButton.addEventListener('click', () => void this.refresh(config));

        const stopButton = actions.createEl('button', { text: t('modal.imageBrowser.remoteStop') });
        stopButton.disabled = snapshot.status !== 'scanning';
        stopButton.addEventListener('click', () => {
            this.scanAbortController?.abort();
            this.scanAbortController = null;
            this.session.stop();
            this.render();
        });

        this.renderReferenceStatus();
        this.renderPage(config);
    }

    private async updateConfig(config: ImageHostingConfig, update: (settings: ReturnType<typeof getRemoteManagementConfig>) => void) {
        const remote = getRemoteManagementConfig(config);
        update(remote);
        config.remoteManagement = remote;
        this.emptyPrefixConfirmed.clear();
        this.session.invalidate();
        await this.plugin.saveSettings();
        this.render();
    }

    private async startScan(config: ImageHostingConfig) {
        const settings = getRemoteManagementConfig(config);
        if (!settings.prefix && !this.emptyPrefixConfirmed.has(config.id)) {
            new ConfirmDialog(this.app, {
                title: t('modal.imageBrowser.remoteConfirmTitle'),
                message: t('modal.imageBrowser.remoteConfirmMessage'),
                confirmText: t('modal.imageBrowser.remoteConfirmContinue'),
                onConfirm: async () => {
                    this.emptyPrefixConfirmed.add(config.id);
                    await this.runScan(config, false);
                },
            }).open();
            return;
        }
        await this.runScan(config, false);
    }

    private async refresh(config: ImageHostingConfig) {
        await this.runScan(config, true);
    }

    private async runScan(config: ImageHostingConfig, refresh: boolean) {
        const result = createRemoteObjectProvider(config);
        if (result.status !== 'ready' || !result.provider.capabilities.has('list')) return;
        this.scanAbortController?.abort();
        const controller = new AbortController();
        this.scanAbortController = controller;
        this.session.invalidate('scanning');
        this.render();

        try {
            await this.plugin.remoteReferenceIndex.scan({ signal: controller.signal });
        } catch (error) {
            if (controller.signal.aborted) return;
            console.warn('Remote reference scan failed:', error);
        }
        if (controller.signal.aborted) return;

        const completed = refresh
            ? await this.session.refresh(result.provider, config)
            : await this.session.scan(result.provider, config);
        if (controller.signal.aborted || this.scanAbortController !== controller) return;
        this.scanAbortController = null;
        if (!completed && this.session.getSnapshot().error === 'invalid-cursor') {
            this.session.stop();
        }
        this.render();
    }

    private renderReferenceStatus() {
        const state = this.plugin.remoteReferenceIndex.getState();
        let status: string;
        if (state.status === 'empty') {
            status = t('modal.imageBrowser.remoteStatusEmpty');
        } else if (state.status === 'stale') {
            status = t('modal.imageBrowser.remoteStatusStale');
        } else {
            status = t('modal.imageBrowser.remoteStatusFresh', {
                time: new Date(state.summary.scannedAt).toLocaleString(),
                count: String(state.summary.markdownFileCount),
            });
        }
        this.containerEl.createDiv({
            cls: 'remote-image-browser-reference-status',
            text: t('modal.imageBrowser.remoteStatus', { status }),
        });
    }

    private renderPage(config: ImageHostingConfig) {
        const snapshot = this.session.getSnapshot();
        if (snapshot.status === 'error') {
            const message = snapshot.error === 'invalid-cursor'
                ? t('modal.imageBrowser.remoteInvalidCursor')
                : t('modal.imageBrowser.remoteError', { error: snapshot.error ?? 'request-failed' });
            this.containerEl.createDiv({ cls: 'remote-image-browser-message mod-warning', text: message });
        }

        const tools = this.containerEl.createDiv({ cls: 'remote-image-browser-page-tools' });
        const search = tools.createEl('input', { attr: { type: 'text', placeholder: t('modal.imageBrowser.searchPlaceholder') }, value: this.keyword });
        search.addEventListener('input', () => {
            this.keyword = search.value;
            this.render();
        });
        const sort = tools.createEl('select');
        for (const [value, label] of [['key', t('modal.imageBrowser.sortName')], ['size', t('modal.imageBrowser.sortSize')], ['modified', t('modal.imageBrowser.sortModified')]] as const) {
            sort.createEl('option', { value, text: label });
        }
        sort.value = this.sortBy;
        sort.addEventListener('change', () => {
            this.sortBy = sort.value as typeof this.sortBy;
            this.render();
        });
        tools.createSpan({ cls: 'remote-image-browser-page-note', text: t('modal.imageBrowser.remoteCurrentPageOnly') });

        const objects = this.getVisibleObjects();
        if (snapshot.pages.length > 0 && objects.length === 0) {
            this.containerEl.createDiv({ cls: 'image-browser-empty', text: t('modal.imageBrowser.remoteNoObjects') });
        } else if (objects.length > 0) {
            const table = this.containerEl.createEl('table', { cls: 'remote-image-browser-table' });
            const header = table.createEl('thead').createEl('tr');
            for (const text of ['Key', 'Size', 'Modified', 'ETag', 'Storage', 'Reference']) header.createEl('th', { text });
            const body = table.createEl('tbody');
            const lookup = this.plugin.remoteReferenceIndex.createLookup(toUrlMapping(config));
            for (const object of objects) this.renderObjectRow(body, object, lookup.classify(object));
        }

        const pagination = this.containerEl.createDiv({ cls: 'remote-image-browser-pagination' });
        const previous = pagination.createEl('button', { text: t('modal.imageBrowser.remotePrevious') });
        previous.disabled = snapshot.status === 'scanning' || snapshot.currentPageIndex === 0;
        previous.addEventListener('click', () => {
            if (this.session.previous()) this.render();
        });
        pagination.createSpan({ text: `${snapshot.currentPageIndex + 1}` });
        const current = snapshot.pages[snapshot.currentPageIndex];
        const next = pagination.createEl('button', { text: t('modal.imageBrowser.remoteNext') });
        next.disabled = snapshot.status === 'scanning' || !current?.result.isTruncated || !current.result.nextCursor;
        next.addEventListener('click', () => void this.next(config));
    }

    private async next(config: ImageHostingConfig) {
        const result = createRemoteObjectProvider(config);
        if (result.status !== 'ready') return;
        const pending = this.session.next(result.provider, config);
        this.render();
        await pending;
        this.render();
    }

    private getVisibleObjects(): RemoteObject[] {
        const keyword = this.keyword.toLocaleLowerCase();
        return [...this.session.getCurrentObjects()]
            .filter((object) => object.key.toLocaleLowerCase().includes(keyword))
            .sort((left, right) => {
                if (this.sortBy === 'size') return left.size - right.size;
                if (this.sortBy === 'modified') return (left.lastModified ?? 0) - (right.lastModified ?? 0);
                return left.key.localeCompare(right.key);
            });
    }

    private renderObjectRow(rowParent: HTMLElement, object: RemoteObject, state: RemoteReferenceState) {
        const row = rowParent.createEl('tr');
        row.createEl('td', { text: object.key });
        row.createEl('td', { text: formatFileSize(object.size) });
        row.createEl('td', { text: object.lastModified ? new Date(object.lastModified).toLocaleString() : '—' });
        row.createEl('td', { text: object.etag ?? '—' });
        row.createEl('td', { text: object.storageClass ?? '—' });
        row.createEl('td', { text: referenceLabel(state) });
    }
}

function getScope(config: ImageHostingConfig, prefix: string): string {
    const bucket = getBucket(config) || config.name || config.type;
    return prefix ? `${bucket}/${prefix}/` : bucket;
}

function getBucket(config: ImageHostingConfig): string {
    const candidate = config.config as { bucket?: string };
    return candidate.bucket ?? '';
}

function toUrlMapping(config: ImageHostingConfig): RemoteUrlMapping {
    const settings = getRemoteManagementConfig(config);
    return {
        hostingId: config.id,
        urlPrefix: config.urlPrefix,
        publicUrlAliases: settings.publicUrlAliases,
    };
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
