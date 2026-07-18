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
import type { RemoteBrowseFailure } from '../remote/browse-session';
import { getRemoteResultPage, type RemoteResultSort } from '../remote/result-page';
import { RemotePreviewSession } from '../remote/preview-session';
import type { RemoteObjectProvider } from '../remote/provider';
import { RemoteImagePreviewModal } from './remote-image-preview';
import {
    getRemotePreviewUnavailableReason,
    type RemotePreviewUnavailableReason,
} from '../remote/preview-policy';

const REMOTE_SCAN_REQUESTS_PER_BATCH = 10;

/** Metadata-first browser view. Remote images are created only in an explicit preview modal. */
export class RemoteImageBrowserView {
    private session = new RemoteBrowseSession();
    private previewSession = new RemotePreviewSession();
    private selectedHostingId = '';
    private emptyPrefixConfirmed = new Set<string>();
    private scanAbortController: AbortController | null = null;
    private searchDebounceTimer: number | null = null;
    private settingsSaveTimer: number | null = null;
    private keyword = '';
    private sortBy: RemoteResultSort = 'key';
    private localPageIndex = 0;
    private pageResultsEl: HTMLElement | null = null;
    private previewCountEl: HTMLElement | null = null;
    private activePreviewModal: RemoteImagePreviewModal | null = null;

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
        this.invalidatePreview();
        this.clearSearchDebounce();
        this.flushScheduledSettingsSave();
        this.scanAbortController?.abort();
        this.scanAbortController = null;
        this.session.stop();
        this.pageResultsEl = null;
        this.previewCountEl = null;
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
        this.clearSearchDebounce();
        this.pageResultsEl = null;
        this.previewCountEl = null;
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
            this.keyword = '';
            this.localPageIndex = 0;
            this.emptyPrefixConfirmed.clear();
            this.invalidatePreview();
            this.session.invalidate();
            this.render();
        });

        const prefixInput = controls.createEl('input', {
            attr: { type: 'text', placeholder: t('modal.imageBrowser.remotePrefix') },
            value: settings.prefix,
        });

        const pageSizeInput = controls.createEl('input', {
            attr: { type: 'number', min: '1', max: '1000', title: t('modal.imageBrowser.remotePageSize') },
            value: String(settings.pageSize),
        });

        const range = this.containerEl.createDiv({
            cls: 'remote-image-browser-range',
            text: t('modal.imageBrowser.remoteRange', { scope: getScope(config, settings.prefix) }),
        });
        prefixInput.addEventListener('input', () => {
            const remote = getRemoteManagementConfig(config);
            const prefix = normalizeRemotePrefix(prefixInput.value);
            if (prefix === remote.prefix) return;
            remote.prefix = prefix;
            config.remoteManagement = remote;
            this.keyword = '';
            this.localPageIndex = 0;
            this.emptyPrefixConfirmed.clear();
            this.invalidatePreview();
            this.session.invalidate();
            if (this.pageResultsEl) this.renderPageResults(config, this.pageResultsEl);
            range.textContent = t('modal.imageBrowser.remoteRange', {
                scope: getScope(config, prefix),
            });
            this.scheduleSettingsSave();
        });
        pageSizeInput.addEventListener('input', () => {
            const remote = getRemoteManagementConfig(config);
            const pageSize = normalizeRemotePageSize(Number(pageSizeInput.value));
            if (pageSize === remote.pageSize) return;
            remote.pageSize = pageSize;
            config.remoteManagement = remote;
            this.localPageIndex = 0;
            if (this.pageResultsEl) this.renderPageResults(config, this.pageResultsEl);
            this.scheduleSettingsSave();
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

        const continueButton = actions.createEl('button', { text: t('modal.imageBrowser.remoteContinueScan') });
        continueButton.disabled = snapshot.status === 'scanning' || !this.session.hasMore();
        continueButton.addEventListener('click', () => void this.continueScan(config));

        const stopButton = actions.createEl('button', { text: t('modal.imageBrowser.remoteStop') });
        stopButton.disabled = snapshot.status !== 'scanning';
        stopButton.addEventListener('click', () => {
            this.scanAbortController?.abort();
            this.scanAbortController = null;
            this.session.stop();
            this.render();
        });
        actions.createSpan({
            cls: 'remote-image-browser-page-note',
            text: t('modal.imageBrowser.remoteScanProgress', {
                count: String(this.session.getAllObjects().length),
                requests: String(snapshot.pages.length),
            }),
        });
        this.previewCountEl = actions.createSpan({
            cls: 'remote-image-browser-page-note',
            text: this.getPreviewCountText(),
        });

        this.renderReferenceStatus();
        this.renderPage(config);
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
                    await this.runScan(config);
                },
            }).open();
            return;
        }
        await this.runScan(config);
    }

    private async refresh(config: ImageHostingConfig) {
        await this.runScan(config);
    }

    private async runScan(config: ImageHostingConfig) {
        const result = createRemoteObjectProvider(config);
        if (result.status !== 'ready' || !result.provider.capabilities.has('list')) return;
        this.invalidatePreview();
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

        this.localPageIndex = 0;
        const firstPageLoaded = await this.session.scan(result.provider, config);
        const completed = firstPageLoaded && await this.session.loadNextBatch(
            result.provider,
            config,
            REMOTE_SCAN_REQUESTS_PER_BATCH - 1
        );
        if (controller.signal.aborted || this.scanAbortController !== controller) return;
        this.scanAbortController = null;
        if (!completed && this.session.getSnapshot().error?.code === 'invalid-cursor') {
            this.session.stop();
        }
        this.render();
    }

    private async continueScan(config: ImageHostingConfig) {
        const result = createRemoteObjectProvider(config);
        if (result.status !== 'ready' || !this.session.hasMore()) return;
        this.scanAbortController?.abort();
        const controller = new AbortController();
        this.scanAbortController = controller;
        const pending = this.session.loadNextBatch(
            result.provider,
            config,
            REMOTE_SCAN_REQUESTS_PER_BATCH
        );
        this.render();
        const completed = await pending;
        if (controller.signal.aborted || this.scanAbortController !== controller) return;
        this.scanAbortController = null;
        if (!completed && this.session.getSnapshot().error?.code === 'invalid-cursor') {
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
            const message = getRemoteFailureMessage(snapshot.error);
            this.containerEl.createDiv({ cls: 'remote-image-browser-message mod-warning', text: message });
        }

        const tools = this.containerEl.createDiv({ cls: 'remote-image-browser-page-tools' });
        const results = this.containerEl.createDiv({ cls: 'remote-image-browser-page-results' });
        this.pageResultsEl = results;
        const search = tools.createEl('input', { attr: { type: 'text', placeholder: t('modal.imageBrowser.searchPlaceholder') }, value: this.keyword });
        search.addEventListener('input', () => {
            this.keyword = search.value;
            this.localPageIndex = 0;
            this.clearSearchDebounce();
            this.searchDebounceTimer = window.setTimeout(() => {
                this.searchDebounceTimer = null;
                this.renderPageResults(config, results);
            }, 300);
        });
        const sort = tools.createEl('select');
        for (const [value, label] of [['key', t('modal.imageBrowser.sortName')], ['size', t('modal.imageBrowser.sortSize')], ['modified', t('modal.imageBrowser.sortModified')]] as const) {
            sort.createEl('option', { value, text: label });
        }
        sort.value = this.sortBy;
        sort.addEventListener('change', () => {
            this.sortBy = sort.value as typeof this.sortBy;
            this.localPageIndex = 0;
            this.clearSearchDebounce();
            this.renderPageResults(config, results);
        });
        tools.createSpan({ cls: 'remote-image-browser-page-note', text: t('modal.imageBrowser.remoteLoadedResultsOnly') });

        this.renderPageResults(config, results);
    }

    private renderPageResults(config: ImageHostingConfig, container: HTMLElement) {
        container.empty();
        const snapshot = this.session.getSnapshot();
        const settings = getRemoteManagementConfig(config);
        const resultPage = getRemoteResultPage(
            this.session.getAllObjects(),
            this.keyword,
            this.sortBy,
            settings.pageSize,
            this.localPageIndex
        );
        this.localPageIndex = resultPage.pageIndex;
        const { objects, pageCount } = resultPage;
        if (snapshot.pages.length > 0 && objects.length === 0) {
            container.createDiv({
                cls: 'image-browser-empty',
                text: t(this.keyword
                    ? 'modal.imageBrowser.remoteNoMatches'
                    : 'modal.imageBrowser.remoteNoObjects'),
            });
        } else if (objects.length > 0) {
            const table = container.createEl('table', { cls: 'remote-image-browser-table' });
            const header = table.createEl('thead').createEl('tr');
            for (const text of ['Key', 'Size', 'Modified', 'ETag', 'Storage', 'Reference', t('modal.imageBrowser.remoteAction')]) {
                header.createEl('th', { text });
            }
            const body = table.createEl('tbody');
            const providerResult = createRemoteObjectProvider(config);
            const mapping = providerResult.status === 'ready'
                ? providerResult.provider.referenceMapping ?? toUrlMapping(config)
                : toUrlMapping(config);
            const lookup = this.plugin.remoteReferenceIndex.createLookup(mapping);
            const provider = providerResult.status === 'ready' ? providerResult.provider : undefined;
            for (const object of objects) {
                this.renderObjectRow(body, config, provider, object, lookup.classify(object));
            }
        }

        const pagination = container.createDiv({ cls: 'remote-image-browser-pagination' });
        const previous = pagination.createEl('button', { text: t('modal.imageBrowser.remotePrevious') });
        previous.disabled = this.localPageIndex === 0;
        previous.addEventListener('click', () => {
            if (this.localPageIndex === 0) return;
            this.localPageIndex--;
            this.renderPageResults(config, container);
        });
        pagination.createSpan({ text: `${this.localPageIndex + 1} / ${pageCount}` });
        const next = pagination.createEl('button', { text: t('modal.imageBrowser.remoteNext') });
        next.disabled = this.localPageIndex >= pageCount - 1;
        next.addEventListener('click', () => {
            if (this.localPageIndex >= pageCount - 1) return;
            this.localPageIndex++;
            this.renderPageResults(config, container);
        });
    }

    private clearSearchDebounce() {
        if (this.searchDebounceTimer === null) return;
        window.clearTimeout(this.searchDebounceTimer);
        this.searchDebounceTimer = null;
    }

    private scheduleSettingsSave() {
        if (this.settingsSaveTimer !== null) window.clearTimeout(this.settingsSaveTimer);
        this.settingsSaveTimer = window.setTimeout(() => {
            this.settingsSaveTimer = null;
            void this.plugin.saveSettings();
        }, 300);
    }

    private flushScheduledSettingsSave() {
        if (this.settingsSaveTimer === null) return;
        window.clearTimeout(this.settingsSaveTimer);
        this.settingsSaveTimer = null;
        void this.plugin.saveSettings();
    }

    private renderObjectRow(
        rowParent: HTMLElement,
        config: ImageHostingConfig,
        provider: RemoteObjectProvider | undefined,
        object: RemoteObject,
        state: RemoteReferenceState
    ) {
        const row = rowParent.createEl('tr');
        row.createEl('td', { text: object.key });
        row.createEl('td', { text: formatFileSize(object.size) });
        row.createEl('td', { text: object.lastModified ? new Date(object.lastModified).toLocaleString() : '—' });
        row.createEl('td', { text: object.etag ?? '—' });
        row.createEl('td', { text: object.storageClass ?? '—' });
        row.createEl('td', { text: referenceLabel(state) });
        const actionCell = row.createEl('td');
        const unavailableReason = getRemotePreviewUnavailableReason(
            config,
            provider,
            object,
            this.plugin.settings.supportedExtensions
        );
        const unavailable = unavailableReason
            ? getPreviewUnavailableMessage(unavailableReason)
            : undefined;
        const preview = actionCell.createEl('button', {
            text: t('modal.imageBrowser.remotePreview'),
            attr: unavailable ? { title: unavailable } : {},
        });
        preview.disabled = unavailable !== undefined;
        if (provider && !unavailable) {
            preview.addEventListener('click', () => this.openPreview(provider, object));
        }
    }

    private openPreview(provider: RemoteObjectProvider, object: RemoteObject): void {
        this.activePreviewModal?.close();
        let modal: RemoteImagePreviewModal;
        modal = new RemoteImagePreviewModal(
            this.app,
            object,
            (force) => this.previewSession.resolveUrl(provider, object, { force }),
            () => {
                this.previewSession.recordImageRequest();
                if (this.previewCountEl) this.previewCountEl.textContent = this.getPreviewCountText();
            },
            () => {
                if (this.activePreviewModal === modal) {
                    this.activePreviewModal = null;
                    this.previewSession.invalidate();
                }
            }
        );
        this.activePreviewModal = modal;
        modal.open();
    }

    private invalidatePreview(): void {
        const modal = this.activePreviewModal;
        this.activePreviewModal = null;
        modal?.close();
        this.previewSession.invalidate();
    }

    private getPreviewCountText(): string {
        return t('modal.imageBrowser.remotePreviewCount', {
            count: String(this.previewSession.getRequestCount()),
        });
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

function getPreviewUnavailableMessage(reason: RemotePreviewUnavailableReason): string {
    const keys: Record<RemotePreviewUnavailableReason, string> = {
        unsupported: 'modal.remotePreview.unsupported',
        'public-url-required': 'modal.remotePreview.publicUrlRequired',
        archived: 'modal.remotePreview.archived',
        'not-image': 'modal.remotePreview.notImage',
    };
    return t(keys[reason]);
}

function getRemoteFailureMessage(failure: RemoteBrowseFailure | undefined): string {
    if (failure?.code === 'invalid-cursor') return t('modal.imageBrowser.remoteInvalidCursor');
    const keyByCode: Record<Exclude<RemoteBrowseFailure['code'], 'invalid-cursor'>, string> = {
        configuration: 'modal.imageBrowser.remoteErrorConfiguration',
        authentication: 'modal.imageBrowser.remoteErrorAuthentication',
        permission: 'modal.imageBrowser.remoteErrorPermission',
        'not-found': 'modal.imageBrowser.remoteErrorNotFound',
        'rate-limit': 'modal.imageBrowser.remoteErrorRateLimit',
        network: 'modal.imageBrowser.remoteErrorNetwork',
        parsing: 'modal.imageBrowser.remoteErrorParsing',
        unsupported: 'modal.imageBrowser.remoteErrorUnsupported',
        service: 'modal.imageBrowser.remoteErrorService',
        unknown: 'modal.imageBrowser.remoteErrorUnknown',
        'request-failed': 'modal.imageBrowser.remoteErrorUnknown',
    };
    const detail = t(keyByCode[failure?.code ?? 'request-failed']);
    return failure?.status === undefined
        ? t('modal.imageBrowser.remoteError', { error: detail })
        : t('modal.imageBrowser.remoteErrorWithStatus', {
            error: detail,
            status: String(failure.status),
        });
}
