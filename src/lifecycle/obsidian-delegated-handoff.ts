import { Notice, TFile, type App, type Editor } from 'obsidian';
import type { ImageHostingConfig, ImageManagerSettings, ImageReference } from '../types';
import type { ReferenceTemplateFileVars } from '../utils/reference-template';
import { RefConverter } from '../utils/ref-converter';
import { scanLocalOrphans } from '../utils/local-orphan-management';
import { PasteLifecycleCoordinator, type HandoffReadyItem, type PasteLifecycleCancellation } from './paste-lifecycle';
import type { UploadOperationResult, UploadService } from '../uploaders/upload-service';
import { getDelegatedReferenceId } from './reference-identity';
import { UploadConcurrencyLimiter } from './upload-concurrency-limiter';
import { t } from '../i18n';

interface DelegatedItem {
    file?: TFile;
    moved: boolean;
    referenceId?: string;
}

interface DelegatedTransaction {
    note: TFile;
    editor: Editor;
    items: DelegatedItem[];
    hosting: ImageHostingConfig;
    keepLocalCopy: boolean;
    compressBeforeUpload: boolean;
    compressQuality: number;
    uploadPathTemplate: string;
    customReferenceTemplate: string;
    completedItems: number;
}

export interface DelegatedHandoffDependencies {
    app: App;
    getSettings: () => ImageManagerSettings;
    uploadService: UploadService;
    refConverter: RefConverter;
    isImageFile: (file: TFile) => boolean;
    buildUploadedReference: (url: string, vars: ReferenceTemplateFileVars, alt?: string, template?: string) => string;
    getReferenceTemplateFileVars: (file: TFile, template?: string) => Promise<ReferenceTemplateFileVars>;
    getDefaultHostingConfig: () => ImageHostingConfig | null;
    notice: (message: string, timeout?: number) => Notice;
}

/** Obsidian adapter for the pure delegated paste lifecycle coordinator. */
export class ObsidianDelegatedHandoff {
    private readonly coordinator: PasteLifecycleCoordinator;
    private readonly transactions = new Map<string, DelegatedTransaction>();
    private readonly uploadLimiter = new UploadConcurrencyLimiter(2);

    constructor(private readonly deps: DelegatedHandoffDependencies) {
        this.coordinator = new PasteLifecycleCoordinator(
            {
                schedule: (delay, callback) => window.setTimeout(callback, delay),
                cancel: (id) => window.clearTimeout(id),
            },
            (item) => { void this.handoff(item); },
            (cancellation) => this.handleCancellation(cancellation)
        );
    }

    start(editor: Editor, note: TFile | null, imageCount: number): void {
        const settings = this.deps.getSettings();
        if (settings.localManagementMode !== 'delegated' || !settings.autoUploadOnPaste || !note) return;
        const hosting = this.deps.getDefaultHostingConfig();
        if (!hosting) return;
        const id = this.coordinator.start(note.path, imageCount);
        this.transactions.set(id, {
            note,
            editor,
            items: Array.from({ length: imageCount }, () => ({ moved: false })),
            hosting: this.cloneHosting(hosting),
            keepLocalCopy: settings.keepLocalCopy,
            compressBeforeUpload: settings.compressBeforeUpload,
            compressQuality: settings.compressQuality,
            uploadPathTemplate: settings.uploadPathTemplate,
            customReferenceTemplate: settings.customReferenceTemplate,
            completedItems: 0,
        });
    }

    onCreate(file: TFile): void {
        if (!this.deps.isImageFile(file)) return;
        for (const [id, transaction] of this.transactions) {
            const index = transaction.items.findIndex((item) => !item.file);
            if (index < 0) continue;
            transaction.items[index]!.file = file;
            this.coordinator.observeCandidate(id, index, file.path, file.path);
            void this.resolveReferences(id, transaction);
            this.scheduleResolve(id, transaction);
            return;
        }
    }

    onRename(file: TFile): void {
        for (const [id, transaction] of this.transactions) {
            const index = transaction.items.findIndex((item) => item.file === file);
            if (index < 0) continue;
            transaction.items[index]!.moved = true;
            this.coordinator.observeCandidate(id, index, file.path, file.path);
            void this.resolveReferences(id, transaction);
            this.scheduleResolve(id, transaction);
        }
    }

    onModify(file: TFile): void {
        for (const [id, transaction] of this.transactions) {
            if (transaction.note.path !== file.path) continue;
            void this.resolveReferences(id, transaction);
        }
    }

    cancelAll(reason: 'unload' | 'cancelled' = 'cancelled'): void {
        this.coordinator.cancelAll(reason);
    }

    isTrackingFile(file: TFile): boolean {
        for (const transaction of this.transactions.values()) {
            if (transaction.items.some((item) => item.file === file)) return true;
        }
        return false;
    }

    private async resolveReferences(id: string, transaction: DelegatedTransaction): Promise<void> {
        const content = await this.readCurrentContent(transaction);
        const references = this.deps.refConverter.parseReferences(content);
        for (let index = 0; index < transaction.items.length; index++) {
            const item = transaction.items[index]!;
            if (!item.file) continue;
            const matches = references.filter((reference) => this.resolvesTo(reference, transaction.note, item.file!));
            if (matches.length !== 1) {
                this.coordinator.invalidate(id, index);
                continue;
            }
            const reference = matches[0]!;
            item.referenceId = this.referenceId(reference);
            this.coordinator.observeReference(
                id,
                index,
                item.file.path,
                this.referenceId(reference),
                item.moved
            );
        }
    }

    private scheduleResolve(id: string, transaction: DelegatedTransaction): void {
        window.setTimeout(() => { void this.resolveReferences(id, transaction); }, 250);
    }

    private async handoff(ready: HandoffReadyItem): Promise<void> {
        const transaction = this.transactions.get(ready.transactionId);
        const item = transaction?.items[ready.itemIndex];
        if (!transaction || !item?.file || item.referenceId !== ready.referenceId) return;
        if (this.deps.getSettings().localManagementMode !== 'delegated' ||
            !this.deps.getSettings().autoUploadOnPaste ||
            !this.isHostingStillEnabled(transaction.hosting)) {
            this.completeItem(ready);
            return;
        }

        const result = await this.uploadLimiter.run(() =>
            this.deps.uploadService.uploadFile(item.file!, transaction.hosting, {
                maxRetries: 2,
                compressBeforeUpload: transaction.compressBeforeUpload,
                compressQuality: transaction.compressQuality,
                uploadPathTemplate: transaction.uploadPathTemplate,
            })
        );
        if (!result.success || !result.url) {
            this.deps.notice(t('notice.delegatedUploadFailed'), 5000);
            this.completeItem(ready);
            return;
        }

        if (!this.coordinator.isCurrent(ready.transactionId, ready.itemIndex, ready.referenceId)) return;
        const replacement = await this.replaceExactReference(transaction, item.file, ready.referenceId, result);
        if (!replacement) {
            this.deps.notice(t('notice.delegatedReferenceChanged'), 6000);
            this.completeItem(ready);
            return;
        }

        if (!transaction.keepLocalCopy) await this.removeIfUnreferenced(item.file, transaction);
        this.deps.notice(t('notice.delegatedUploadSuccess'), 3000);
        this.completeItem(ready);
    }

    private async replaceExactReference(
        transaction: DelegatedTransaction,
        file: TFile,
        referenceId: string,
        result: UploadOperationResult
    ): Promise<boolean> {
        if (!result.url) return false;
        const content = await this.readCurrentContent(transaction);
        const matches = this.deps.refConverter.parseReferences(content)
            .filter((reference) => this.referenceId(reference) === referenceId)
            .filter((reference) => this.resolvesTo(reference, transaction.note, file));
        if (matches.length !== 1) return false;
        const match = matches[0]!;
        const vars = await this.deps.getReferenceTemplateFileVars(file, transaction.customReferenceTemplate);
        const replacement = this.deps.buildUploadedReference(result.url, vars, match.altText, transaction.customReferenceTemplate);
        const editorContent = this.isSourceEditorActive(transaction)
            ? this.readEditorContent(transaction.editor)
            : null;
        if (editorContent === content) {
            const start = this.offsetToPosition(content, match.col);
            const end = this.offsetToPosition(content, match.col + match.fullMatch.length);
            transaction.editor.replaceRange(replacement, start, end);
        } else {
            let replaced = false;
            await this.deps.app.vault.process(transaction.note, (current) => {
                const currentMatches = this.deps.refConverter.parseReferences(current)
                    .filter((reference) => this.referenceId(reference) === referenceId)
                    .filter((reference) => this.resolvesTo(reference, transaction.note, file));
                if (currentMatches.length !== 1) return current;
                const currentMatch = currentMatches[0]!;
                replaced = true;
                return current.substring(0, currentMatch.col) +
                    replacement +
                    current.substring(currentMatch.col + currentMatch.fullMatch.length);
            });
            if (!replaced) return false;
        }
        return true;
    }

    private async removeIfUnreferenced(file: TFile, transaction: DelegatedTransaction): Promise<void> {
        const sourceContent = await this.readCurrentContent(transaction);
        const result = await scanLocalOrphans(
            this.deps.app,
            this.deps.getSettings().supportedExtensions,
            new Map([[transaction.note.path, sourceContent]])
        );
        if (!result.orphans.some((orphan) => orphan.path === file.path)) return;
        await this.deps.app.fileManager.trashFile(file);
    }

    private resolvesTo(reference: ImageReference, note: TFile, file: TFile): boolean {
        return this.deps.app.metadataCache.getFirstLinkpathDest(reference.path, note.path) === file;
    }

    private async readCurrentContent(transaction: DelegatedTransaction): Promise<string> {
        return this.isSourceEditorActive(transaction)
            ? this.readEditorContent(transaction.editor) ?? await this.deps.app.vault.cachedRead(transaction.note)
            : await this.deps.app.vault.cachedRead(transaction.note);
    }

    private readEditorContent(editor: Editor): string | null {
        try {
            return editor.getValue();
        } catch {
            return null;
        }
    }

    private referenceId(reference: ImageReference): string {
        return getDelegatedReferenceId(reference);
    }

    private offsetToPosition(content: string, offset: number): { line: number; ch: number } {
        const before = content.substring(0, offset);
        const lines = before.split('\n');
        return { line: lines.length - 1, ch: lines[lines.length - 1]!.length };
    }

    private isHostingStillEnabled(hosting: ImageHostingConfig): boolean {
        return this.deps.getSettings().hostingConfigs.some((config) => config.id === hosting.id && config.enabled);
    }

    private cloneHosting(config: ImageHostingConfig): ImageHostingConfig {
        return {
            ...config,
            config: { ...config.config },
            ...(config.remoteManagement
                ? { remoteManagement: { ...config.remoteManagement, publicUrlAliases: [...config.remoteManagement.publicUrlAliases] } }
                : {}),
        };
    }

    private completeItem(ready: HandoffReadyItem): void {
        this.coordinator.complete(ready.transactionId, ready.itemIndex);
        const transaction = this.transactions.get(ready.transactionId);
        if (!transaction) return;
        transaction.completedItems++;
        if (transaction.completedItems >= transaction.items.length) this.transactions.delete(ready.transactionId);
    }

    private isSourceEditorActive(transaction: DelegatedTransaction): boolean {
        return this.deps.app.workspace.getActiveFile()?.path === transaction.note.path;
    }

    private handleCancellation(cancellation: PasteLifecycleCancellation): void {
        this.transactions.delete(cancellation.transactionId);
        if (cancellation.reason === 'timeout') {
            this.deps.notice(t('notice.delegatedUploadTimedOut'), 5000);
        }
    }
}
