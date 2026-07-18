import { App, Notice } from 'obsidian';
import type ImageManagerPlugin from '../main';
import type { ImageHostingConfig } from '../types';
import { t } from '../i18n';
import { formatFileSize } from '../utils/path-utils';
import { ConfirmDialog } from './confirm-dialog';
import { RemoteBrowseSession } from '../remote/browse-session';
import { getRemoteManagementConfig, normalizeRemotePrefix } from '../remote/management-settings';
import { createRemoteObjectProvider } from '../remote/provider-factory';
import type {
    RemoteObject,
    RemoteReferenceLocation,
    RemoteReferenceState,
    RemoteUrlMapping,
} from '../remote/types';
import type { RemoteBrowseFailure } from '../remote/browse-session';
import { getRemoteResults, type RemoteResultSort } from '../remote/result-page';
import { RemotePreviewSession } from '../remote/preview-session';
import { RemoteThumbnailSession } from '../remote/thumbnail-session';
import type { RemoteObjectProvider } from '../remote/provider';
import { RemoteImagePreviewModal } from './remote-image-preview';
import {
    getRemotePreviewUnavailableReason,
    type RemotePreviewUnavailableReason,
} from '../remote/preview-policy';
import { RemoteDeleteSession } from '../remote/delete-session';
import type { RemoteDeleteBatchSnapshot } from '../remote/delete-session';
import type {
    RemoteDeleteEligibilityContext,
    RemoteDeleteUnavailableReason,
} from '../remote/delete-policy';
import { getRemoteDeleteUnavailableReason } from '../remote/delete-policy';
import { RemoteDeleteConfirmModal } from './remote-delete-confirm';
import { RemoteDeleteResultsModal } from './remote-delete-results';
import { RemoteImageGrid } from './remote-image-grid';

const REMOTE_SCAN_REQUESTS_PER_BATCH = 10;

type RemoteReferenceFilter = 'all' | RemoteReferenceState;

/** S3-first card browser with explicit scanning and viewport thumbnail loading. */
export class RemoteImageBrowserView {
    private session = new RemoteBrowseSession();
    private previewSession = new RemotePreviewSession();
    private thumbnailSession = new RemoteThumbnailSession(this.previewSession);
    private deleteSession = new RemoteDeleteSession();
    private selectedHostingId = '';
    private emptyPrefixConfirmed = new Set<string>();
    private scanAbortController: AbortController | null = null;
    private searchDebounceTimer: number | null = null;
    private settingsSaveTimer: number | null = null;
    private keyword = '';
    private sortBy: RemoteResultSort = 'key';
    private referenceFilter: RemoteReferenceFilter = 'all';
    private pageResultsEl: HTMLElement | null = null;
    private resultCountEl: HTMLElement | null = null;
    private imageGrid: RemoteImageGrid | null = null;
    private previewCountEl: HTMLElement | null = null;
    private activePreviewModal: RemoteImagePreviewModal | null = null;
    private activeDeleteResultsModal: RemoteDeleteResultsModal | null = null;
    private removeIndexInvalidationListener: (() => void) | null = null;
    private deleteSummaryEl: HTMLElement | null = null;
    private deleteButton: HTMLButtonElement | null = null;
    private deleteViewGeneration = 0;

    constructor(
        private app: App,
        private plugin: ImageManagerPlugin,
        private containerEl: HTMLElement,
        private closeBrowser: () => void = () => {}
    ) {}

    open() {
        this.removeIndexInvalidationListener ??= this.plugin.remoteReferenceIndex.onInvalidate(() => {
            this.deleteSession.clear();
            this.invalidatePreview();
            this.render();
        });
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
        this.deleteViewGeneration++;
        this.deleteSession.clear();
        this.activeDeleteResultsModal?.close();
        this.activeDeleteResultsModal = null;
        this.removeIndexInvalidationListener?.();
        this.removeIndexInvalidationListener = null;
        this.pageResultsEl = null;
        this.previewCountEl = null;
        this.resultCountEl = null;
        this.deleteSummaryEl = null;
        this.deleteButton = null;
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
        this.destroyGrid();
        this.pageResultsEl = null;
        this.previewCountEl = null;
        this.resultCountEl = null;
        this.deleteSummaryEl = null;
        this.deleteButton = null;
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
            this.referenceFilter = 'all';
            this.emptyPrefixConfirmed.clear();
            this.invalidatePreview();
            this.deleteViewGeneration++;
            this.deleteSession.clear();
            this.session.invalidate();
            this.render();
        });

        const prefixInput = controls.createEl('input', {
            attr: { type: 'text', placeholder: t('modal.imageBrowser.remotePrefix') },
            value: settings.prefix,
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
            this.referenceFilter = 'all';
            this.emptyPrefixConfirmed.clear();
            this.invalidatePreview();
            this.deleteViewGeneration++;
            this.deleteSession.clear();
            this.session.invalidate();
            if (this.pageResultsEl) this.renderPageResults(config, this.pageResultsEl);
            range.textContent = t('modal.imageBrowser.remoteRange', {
                scope: getScope(config, prefix),
            });
            this.scheduleSettingsSave();
        });
        if (providerResult.status === 'unsupported' || !providerResult.provider.capabilities.has('list')) {
            this.containerEl.createDiv({ cls: 'remote-image-browser-message', text: t('modal.imageBrowser.remoteUnsupported') });
            return;
        }

        const actions = this.containerEl.createDiv({ cls: 'remote-image-browser-actions' });
        const snapshot = this.session.getSnapshot();
        const scanButton = actions.createEl('button', {
            text: t(snapshot.status === 'scanning'
                ? 'modal.imageBrowser.remoteScanning'
                : 'modal.imageBrowser.remoteScan'),
            cls: 'mod-cta',
        });
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
        this.containerEl.setAttribute('aria-busy', String(snapshot.status === 'scanning'));
        if (snapshot.status === 'scanning') {
            const loading = this.containerEl.createDiv({
                cls: 'remote-image-browser-loading',
                attr: { role: 'status', 'aria-live': 'polite' },
            });
            loading.createDiv({ cls: 'remote-image-browser-spinner' });
            loading.createSpan({ text: t('modal.imageBrowser.remoteScanLoading') });
        }

        this.renderReferenceStatus();
        this.renderDeleteToolbar(config, providerResult.provider);
        this.renderPage(config);
    }

    private async startScan(config: ImageHostingConfig) {
        const settings = getRemoteManagementConfig(config);
        if (!settings.prefix && !this.emptyPrefixConfirmed.has(config.id)) {
            new ConfirmDialog(this.app, {
                title: t('modal.imageBrowser.remoteConfirmTitle'),
                message: t('modal.imageBrowser.remoteConfirmMessage'),
                confirmText: t('modal.imageBrowser.remoteConfirmContinue'),
                pendingText: t('modal.imageBrowser.remoteScanning'),
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
        this.deleteViewGeneration++;
        this.deleteSession.clear();
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
            this.clearSearchDebounce();
            this.renderPageResults(config, results);
        });
        const referenceFilter = tools.createEl('select', {
            attr: { 'aria-label': t('modal.imageBrowser.remoteReferenceFilter') },
        });
        for (const [value, label] of [
            ['all', t('modal.imageBrowser.remoteReferenceAll')],
            ['not-referenced-in-current-vault', t('modal.imageBrowser.remoteNotReferenced')],
            ['referenced', t('modal.imageBrowser.remoteReferenced')],
            ['unmappable', t('modal.imageBrowser.remoteUnmappable')],
        ] as const) referenceFilter.createEl('option', { value, text: label });
        referenceFilter.value = this.referenceFilter;
        referenceFilter.addEventListener('change', () => {
            this.referenceFilter = referenceFilter.value as RemoteReferenceFilter;
            this.renderPageResults(config, results);
        });
        this.resultCountEl = tools.createSpan({ cls: 'remote-image-browser-page-note' });

        this.renderPageResults(config, results);
    }

    private renderPageResults(config: ImageHostingConfig, container: HTMLElement) {
        this.destroyGrid();
        this.thumbnailSession.resetView();
        container.empty();
        const snapshot = this.session.getSnapshot();
        const providerResult = createRemoteObjectProvider(config);
        const provider = providerResult.status === 'ready' ? providerResult.provider : undefined;
        const mapping = provider?.referenceMapping ?? toUrlMapping(config);
        const lookup = this.plugin.remoteReferenceIndex.createLookup(mapping);
        const allObjects = this.session.getAllObjects();
        const sorted = getRemoteResults(allObjects, this.keyword, this.sortBy);
        const objects = this.referenceFilter === 'all'
            ? sorted
            : sorted.filter((object) => lookup.classify(object) === this.referenceFilter);
        if (this.resultCountEl) {
            this.resultCountEl.textContent = t('modal.imageBrowser.remoteResultCount', {
                count: String(objects.length),
                total: String(allObjects.length),
            });
        }
        if (
            snapshot.pages.length === 0 &&
            objects.length === 0 &&
            snapshot.status !== 'error' &&
            snapshot.status !== 'scanning'
        ) {
            container.createDiv({
                cls: 'image-browser-empty',
                text: t('modal.imageBrowser.remoteScanPrompt'),
            });
        } else if (snapshot.pages.length > 0 && objects.length === 0) {
            container.createDiv({
                cls: 'image-browser-empty',
                text: t(this.keyword || this.referenceFilter !== 'all'
                    ? 'modal.imageBrowser.remoteNoMatches'
                    : 'modal.imageBrowser.remoteNoObjects'),
            });
        } else if (objects.length > 0) {
            const deleteVisible = Boolean(
                provider?.capabilities.has('delete') && provider.deleteObject
            );
            const deleteContext: RemoteDeleteEligibilityContext | undefined = deleteVisible
                ? {
                    config,
                    provider,
                    indexState: this.plugin.remoteReferenceIndex.getState(),
                    scannedObjects: this.session.getAllObjects(),
                    classify: (object) => lookup.classify(object),
                }
                : undefined;
            const items = objects.map((object) => ({
                object,
                referenceState: lookup.classify(object),
                previewUnavailable: getRemotePreviewUnavailableReason(
                    config,
                    provider,
                    object,
                    this.plugin.settings.supportedExtensions
                ),
                deleteUnavailable: deleteContext
                    ? getRemoteDeleteUnavailableReason(object, deleteContext)
                    : undefined,
                references: lookup.getReferences(object),
            }));
            this.imageGrid = new RemoteImageGrid({
                container,
                provider,
                deleteEnabled: deleteVisible,
                items,
                thumbnailSession: this.thumbnailSession,
                isSelected: (object) => this.deleteSession.isSelected(object),
                onSelectionChange: (object, selected, checkbox) => {
                    const currentContext = this.getDeleteContext(config, provider);
                    const result = this.deleteSession.setSelected(object, selected, currentContext);
                    checkbox.checked = result.selected;
                    if (result.reason) {
                        const message = result.reason === 'limit'
                            ? t('modal.imageBrowser.remoteDeleteLimit')
                            : getDeleteUnavailableMessage(result.reason);
                        new Notice(message);
                    }
                    this.updateDeleteToolbar();
                },
                onPreview: (readyProvider, object, references) => {
                    this.openPreview(readyProvider, object, references);
                },
                onImageRequest: () => {
                    this.previewSession.recordImageRequest();
                    if (this.previewCountEl) this.previewCountEl.textContent = this.getPreviewCountText();
                },
                previewUnavailableMessage: getPreviewUnavailableMessage,
                deleteUnavailableMessage: getDeleteUnavailableMessage,
            });
        }
    }

    private destroyGrid(): void {
        this.imageGrid?.destroy();
        this.imageGrid = null;
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

    private openPreview(
        provider: RemoteObjectProvider,
        object: RemoteObject,
        references: readonly RemoteReferenceLocation[]
    ): void {
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
                }
            },
            references,
            this.closeBrowser
        );
        this.activePreviewModal = modal;
        modal.open();
    }

    private invalidatePreview(): void {
        this.destroyGrid();
        const modal = this.activePreviewModal;
        this.activePreviewModal = null;
        modal?.close();
        this.thumbnailSession.invalidate();
    }

    private getPreviewCountText(): string {
        return t('modal.imageBrowser.remotePreviewCount', {
            count: String(this.previewSession.getRequestCount()),
        });
    }

    private renderDeleteToolbar(config: ImageHostingConfig, provider: RemoteObjectProvider): void {
        if (!provider.capabilities.has('delete') || !provider.deleteObject) return;
        const toolbar = this.containerEl.createDiv({ cls: 'remote-delete-toolbar' });
        this.deleteSummaryEl = toolbar.createSpan();
        this.deleteButton = toolbar.createEl('button', {
            text: t('modal.imageBrowser.remoteDeleteSelected'),
            cls: 'mod-warning',
        });
        this.deleteButton.addEventListener('click', () => this.openDeleteConfirmation(config, provider));
        this.updateDeleteToolbar();
    }

    private updateDeleteToolbar(): void {
        const selected = this.deleteSession.getSelectedObjects();
        const totalSize = selected.reduce((total, object) => total + object.size, 0);
        if (this.deleteSummaryEl) {
            this.deleteSummaryEl.textContent = t('modal.imageBrowser.remoteDeleteSelection', {
                count: String(selected.length),
                size: formatFileSize(totalSize),
            });
        }
        if (this.deleteButton) this.deleteButton.disabled = selected.length === 0;
    }

    private getDeleteContext(
        config: ImageHostingConfig,
        provider: RemoteObjectProvider | undefined
    ): RemoteDeleteEligibilityContext {
        const mapping = provider?.referenceMapping ?? toUrlMapping(config);
        const lookup = this.plugin.remoteReferenceIndex.createLookup(mapping);
        return {
            config,
            provider,
            indexState: this.plugin.remoteReferenceIndex.getState(),
            scannedObjects: this.session.getAllObjects(),
            classify: (object) => lookup.classify(object),
        };
    }

    private openDeleteConfirmation(
        config: ImageHostingConfig,
        provider: RemoteObjectProvider,
        retryScanObjects?: readonly RemoteObject[]
    ): void {
        const context = {
            ...this.getDeleteContext(config, provider),
            ...(retryScanObjects ? { scannedObjects: retryScanObjects } : {}),
        };
        const batch = this.deleteSession.createBatch(context);
        if (!batch) {
            this.deleteSession.clear();
            this.updateDeleteToolbar();
            new Notice(t('modal.imageBrowser.remoteDeleteRefreshRequired'));
            return;
        }
        new RemoteDeleteConfirmModal({
            hostingName: config.name || config.type.toUpperCase(),
            bucket: getBucket(config),
            prefix: getRemoteManagementConfig(config).prefix,
            batch,
            validate: () => {
                const currentConfig = this.getSelectedConfig();
                if (!currentConfig || currentConfig.id !== config.id) return false;
                const currentProvider = createRemoteObjectProvider(currentConfig);
                if (currentProvider.status !== 'ready') return false;
                const validationContext = {
                    ...this.getDeleteContext(currentConfig, currentProvider.provider),
                    ...(retryScanObjects ? { scannedObjects: retryScanObjects } : {}),
                };
                return this.deleteSession.validateBatch(batch, validationContext);
            },
            onInvalid: () => {
                this.deleteSession.clear();
                this.updateDeleteToolbar();
                new Notice(t('modal.imageBrowser.remoteDeleteRefreshRequired'));
            },
            onConfirm: () => void this.executeDeleteBatch(config, provider, batch),
        }, this.app).open();
    }

    private async executeDeleteBatch(
        config: ImageHostingConfig,
        provider: RemoteObjectProvider,
        batch: RemoteDeleteBatchSnapshot
    ): Promise<void> {
        this.activeDeleteResultsModal?.close();
        const runGeneration = ++this.deleteViewGeneration;
        const modal = new RemoteDeleteResultsModal(this.app, batch.objects.length, {
            onStop: () => this.deleteSession.stop(),
            onClose: () => {
                if (this.activeDeleteResultsModal === modal) {
                    this.activeDeleteResultsModal = null;
                }
                this.deleteViewGeneration++;
            },
            onRetry: (objects) => {
                modal.close();
                const currentConfig = this.getSelectedConfig();
                if (!currentConfig || currentConfig.id !== config.id) {
                    new Notice(t('modal.imageBrowser.remoteDeleteRefreshRequired'));
                    return;
                }
                const currentProvider = createRemoteObjectProvider(currentConfig);
                if (currentProvider.status !== 'ready') {
                    new Notice(t('modal.imageBrowser.remoteDeleteRefreshRequired'));
                    return;
                }
                const context = {
                    ...this.getDeleteContext(currentConfig, currentProvider.provider),
                    // A retry may follow a partially accepted batch whose visible list was
                    // invalidated. Only the original failed objects remain eligible here.
                    scannedObjects: batch.objects,
                };
                const result = this.deleteSession.replaceSelection(objects, context);
                this.updateDeleteToolbar();
                if (result.selected) {
                    this.openDeleteConfirmation(currentConfig, currentProvider.provider, batch.objects);
                } else {
                    new Notice(t('modal.imageBrowser.remoteDeleteRefreshRequired'));
                }
            },
            onRescan: () => {
                modal.close();
                void this.startScan(config);
            },
        });
        this.activeDeleteResultsModal = modal;
        modal.open();
        const results = await this.deleteSession.run(provider, batch, {
            onResult: async (object, result) => {
                try {
                    await this.plugin.recordRemoteDeleteAudit({
                        completedAt: Date.now(),
                        hostingId: object.hostingId,
                        key: object.key,
                        success: result.success,
                        ...(result.status !== undefined ? { status: result.status } : {}),
                        ...(result.deletionKind ? { deletionKind: result.deletionKind } : {}),
                        ...(result.failureCode ? { failureCode: result.failureCode } : {}),
                    });
                } catch {
                    new Notice(t('modal.remoteDeleteResults.auditFailed'));
                }
                modal.addResult(object, result);
            },
        });
        modal.finish();
        if (
            runGeneration === this.deleteViewGeneration &&
            results.some((result) => result.success)
        ) {
            this.invalidatePreview();
            this.deleteSession.clear();
            this.session.invalidate();
            this.render();
        }
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

function getPreviewUnavailableMessage(reason: RemotePreviewUnavailableReason): string {
    const keys: Record<RemotePreviewUnavailableReason, string> = {
        unsupported: 'modal.remotePreview.unsupported',
        'public-url-required': 'modal.remotePreview.publicUrlRequired',
        archived: 'modal.remotePreview.archived',
        'not-image': 'modal.remotePreview.notImage',
    };
    return t(keys[reason]);
}

function getDeleteUnavailableMessage(reason: RemoteDeleteUnavailableReason): string {
    const keys: Record<typeof reason, string> = {
        unsupported: 'modal.imageBrowser.remoteDeleteUnsupported',
        'index-empty': 'modal.imageBrowser.remoteDeleteIndexEmpty',
        'index-stale': 'modal.imageBrowser.remoteDeleteIndexStale',
        referenced: 'modal.imageBrowser.remoteDeleteReferenced',
        'possibly-referenced': 'modal.imageBrowser.remoteDeletePossible',
        unmappable: 'modal.imageBrowser.remoteDeleteUnmappable',
        'wrong-hosting': 'modal.imageBrowser.remoteDeleteWrongHosting',
        'outside-prefix': 'modal.imageBrowser.remoteDeleteOutsidePrefix',
        'not-in-scan': 'modal.imageBrowser.remoteDeleteNotInScan',
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
