import { MarkdownView, Notice, TFile, type App, type Editor } from 'obsidian';
import type { ImageHostingConfig, ImageManagerSettings, ImageReference } from '../types';
import type { ReferenceTemplateFileVars } from '../utils/reference-template';
import { RefConverter } from '../utils/ref-converter';
import { scanLocalOrphans } from '../utils/local-orphan-management';
import {
    PasteLifecycleCoordinator,
    type HandoffReadyItem,
    type PasteLifecycleCancellation,
    type PasteLifecycleItemCancellation,
} from './paste-lifecycle';
import type { UploadOperationResult, UploadService } from '../uploaders/upload-service';
import { getDelegatedReferenceId } from './reference-identity';
import { UploadConcurrencyLimiter } from './upload-concurrency-limiter';
import { t } from '../i18n';
import { DelegatedTransactionMatcher, type DelegatedItemClaim } from './delegated-transaction-matcher';
import { KeyedSerialExecutor } from './keyed-serial-executor';
import {
    summarizeDelegatedTransaction,
    type DelegatedTransactionOutcome,
} from './delegated-transaction-summary';

interface DelegatedItem {
    file?: TFile;
    fileId?: string;
    moved: boolean;
    referenceId?: string;
    replacementApplied?: boolean;
    replacementReference?: string;
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
    settingsFingerprint: string;
    baselineReferenceCounts: Map<string, number>;
    matcher: DelegatedTransactionMatcher;
    outcomes: Array<DelegatedTransactionOutcome | undefined>;
    activeHandoffs: number;
    noticeFinished: boolean;
    protectedFiles: Set<string>;
    movedFiles: Set<string>;
    resolveTimers: Set<number>;
    releasedProtections: Set<string>;
    protectionWaits: Map<number, { itemIndex: number; resolve: (completed: boolean) => void }>;
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
    beginIndeterminate: (file: TFile) => void;
    touchIndeterminate: (file: TFile) => void;
    endIndeterminate: (file: TFile) => void;
    isIndeterminate: (file: TFile) => boolean;
}

/** Obsidian adapter for the pure delegated paste lifecycle coordinator. */
export class ObsidianDelegatedHandoff {
    private readonly coordinator: PasteLifecycleCoordinator;
    private readonly transactions = new Map<string, DelegatedTransaction>();
    private readonly uploadLimiter = new UploadConcurrencyLimiter(2);
    private readonly noteEffects = new KeyedSerialExecutor();
    private readonly fileIds = new WeakMap<TFile, string>();
    private readonly filesById = new Map<string, TFile>();
    private readonly claimedFileOwners = new Map<string, string>();
    private nextFileId = 1;

    constructor(private readonly deps: DelegatedHandoffDependencies) {
        this.coordinator = new PasteLifecycleCoordinator(
            {
                schedule: (delay, callback) => window.setTimeout(callback, delay),
                cancel: (id) => window.clearTimeout(id),
            },
            (item) => { void this.handoff(item); },
            (cancellation) => this.handleCancellation(cancellation),
            (cancellation) => this.handleItemCancellation(cancellation)
        );
    }

    start(editor: Editor, note: TFile | null, imageCount: number): void {
        const settings = this.deps.getSettings();
        if (settings.localManagementMode !== 'delegated' || !settings.autoUploadOnPaste || !note) return;
        const hosting = this.deps.getDefaultHostingConfig();
        if (!hosting) return;
        const initialContent = this.readEditorContent(editor);
        if (initialContent === null) return;
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
            settingsFingerprint: this.settingsFingerprint(settings, hosting),
            baselineReferenceCounts: this.countReferenceIds(this.deps.refConverter.parseReferences(initialContent)),
            matcher: new DelegatedTransactionMatcher(imageCount),
            outcomes: Array.from({ length: imageCount }),
            activeHandoffs: 0,
            noticeFinished: false,
            protectedFiles: new Set(),
            movedFiles: new Set(),
            resolveTimers: new Set(),
            releasedProtections: new Set(),
            protectionWaits: new Map(),
        });
    }

    onCreate(file: TFile): void {
        if (!this.deps.isImageFile(file)) return;
        const fileId = this.getFileId(file);
        for (const [id, transaction] of this.transactions) {
            transaction.matcher.observeCandidate(fileId, file.path);
            if (!transaction.protectedFiles.has(fileId)) {
                transaction.protectedFiles.add(fileId);
                this.deps.beginIndeterminate(file);
            }
            this.safelyResolveReferences(id, transaction);
            this.scheduleResolve(id, transaction);
        }
    }

    onRename(file: TFile): void {
        for (const [id, transaction] of this.transactions) {
            const fileId = this.fileIds.get(file);
            if (!fileId || !transaction.matcher.observesCandidate(fileId)) continue;
            this.deps.touchIndeterminate(file);
            transaction.movedFiles.add(fileId);
            transaction.matcher.observeCandidate(fileId, file.path);
            const index = transaction.items.findIndex((item) => item.fileId === fileId);
            if (index >= 0) {
                transaction.items[index]!.moved = true;
                this.coordinator.invalidate(id, index);
                this.coordinator.observeCandidate(id, index, fileId, file.path);
            }
            this.safelyResolveReferences(id, transaction);
            this.scheduleResolve(id, transaction);
        }
    }

    onModify(file: TFile): void {
        for (const [id, transaction] of this.transactions) {
            if (transaction.note.path === file.path) {
                this.safelyResolveReferences(id, transaction);
                continue;
            }
            const fileId = this.fileIds.get(file);
            if (!fileId || !transaction.matcher.observesCandidate(fileId)) continue;
            this.deps.touchIndeterminate(file);
            const index = transaction.items.findIndex((item) => item.fileId === fileId);
            if (index >= 0) this.coordinator.invalidate(id, index);
        }
    }

    onDelete(file: TFile): void {
        for (const [id, transaction] of this.transactions) {
            if (transaction.note === file) {
                this.coordinator.cancel(id, 'cancelled');
                continue;
            }
            const fileId = this.fileIds.get(file);
            if (!fileId || !transaction.matcher.observesCandidate(fileId)) continue;
            const index = transaction.items.findIndex((item) => item.fileId === fileId);
            if (index >= 0) this.coordinator.cancelItem(id, index, 'cancelled');
            transaction.matcher.removeCandidate(fileId);
        }
    }

    cancelAll(reason: 'unload' | 'cancelled' = 'cancelled'): void {
        this.coordinator.cancelAll(reason);
    }

    isTrackingFile(file: TFile): boolean {
        const fileId = this.fileIds.get(file);
        if (!fileId) return false;
        for (const transaction of this.transactions.values()) {
            if (transaction.matcher.observesCandidate(fileId)) return true;
        }
        return false;
    }

    private async resolveReferences(id: string, transaction: DelegatedTransaction): Promise<void> {
        const content = await this.readCurrentContent(transaction);
        if (this.transactions.get(id) !== transaction) return;
        const references = this.transactionReferences(transaction, this.deps.refConverter.parseReferences(content));
        const resolved = references.map((reference) => {
            const file = this.deps.app.metadataCache.getFirstLinkpathDest(reference.path, transaction.note.path);
            if (!(file instanceof TFile)) return null;
            const fileId = this.fileIds.get(file);
            if (!fileId) return null;
            return { fileId, filePath: file.path, referenceId: this.referenceId(reference) };
        }).filter((reference): reference is NonNullable<typeof reference> => reference !== null);
        if (new Set(resolved.map((reference) => reference.fileId)).size > transaction.items.length) {
            this.coordinator.cancel(id, 'ambiguous');
            return;
        }
        const excluded = new Set(Array.from(this.claimedFileOwners.entries())
            .filter(([, owner]) => owner !== id)
            .map(([fileId]) => fileId));
        const proposals = transaction.matcher.propose(resolved, excluded);
        const hasCompetingClaim = proposals.some((proposal) =>
            Array.from(this.transactions.entries()).some(([otherId, other]) => {
                if (otherId === id || other.note.path !== transaction.note.path) return false;
                const otherExcluded = new Set(Array.from(this.claimedFileOwners.entries())
                    .filter(([, owner]) => owner !== otherId)
                    .map(([fileId]) => fileId));
                return other.matcher.propose(resolved, otherExcluded).some((candidate) =>
                    candidate.fileId === proposal.fileId && candidate.referenceId === proposal.referenceId
                );
            })
        );
        if (proposals.length > 0 && !hasCompetingClaim) this.applyClaims(id, transaction, proposals);

        for (let index = 0; index < transaction.items.length; index++) {
            const item = transaction.items[index]!;
            if (!item.file) continue;
            const matches = references.filter((reference) => this.resolvesTo(reference, transaction.note, item.file!));
            if (matches.length !== 1) {
                if (item.replacementApplied && matches.length === 0) continue;
                if (item.referenceId) this.deps.touchIndeterminate(item.file);
                if (matches.length === 0 && item.referenceId && !item.moved) {
                    this.coordinator.cancelItem(id, index, 'cancelled');
                } else {
                    this.coordinator.invalidate(id, index);
                }
                continue;
            }
            const reference = matches[0]!;
            if (item.referenceId && item.referenceId !== this.referenceId(reference)) {
                this.deps.touchIndeterminate(item.file);
            }
            item.referenceId = this.referenceId(reference);
            this.coordinator.observeReference(
                id,
                index,
                item.fileId!,
                this.referenceId(reference),
                item.moved
            );
        }
    }

    private scheduleResolve(id: string, transaction: DelegatedTransaction): void {
        const timer = window.setTimeout(() => {
            transaction.resolveTimers.delete(timer);
            if (this.transactions.get(id) === transaction) this.safelyResolveReferences(id, transaction);
        }, 250);
        transaction.resolveTimers.add(timer);
    }

    private async handoff(ready: HandoffReadyItem): Promise<void> {
        const transaction = this.transactions.get(ready.transactionId);
        const item = transaction?.items[ready.itemIndex];
        if (!transaction || !item?.file || item.referenceId !== ready.referenceId) return;
        transaction.activeHandoffs++;
        let remoteMayExist = false;
        try {
            if (this.deps.getSettings().localManagementMode !== 'delegated' ||
                !this.deps.getSettings().autoUploadOnPaste ||
                !this.isSettingsSnapshotCurrent(transaction)) {
                this.recordOutcome(ready, transaction, { status: 'cancelled' });
                return;
            }

            const result = await this.uploadLimiter.run(() =>
                this.deps.uploadService.uploadFile(item.file!, transaction.hosting, {
                    maxRetries: 2,
                    compressBeforeUpload: transaction.compressBeforeUpload,
                    compressQuality: transaction.compressQuality,
                    uploadPathTemplate: transaction.uploadPathTemplate,
                    beforeAttempt: () => this.validateReadyItem(ready, transaction, item),
                })
            );
            if (!result.success || !result.url) {
                this.recordOutcome(ready, transaction, {
                    status: result.cancelled ? 'cancelled' : 'failed',
                    ...(result.cancelled ? {} : { reason: t('notice.delegatedUploadFailed') }),
                });
                return;
            }
            remoteMayExist = true;

            if (!await this.validateReadyItem(ready, transaction, item)) {
                this.recordOutcome(ready, transaction, {
                    status: 'unapplied',
                    reason: t('notice.delegatedReferenceChanged'),
                });
                return;
            }

            await this.noteEffects.run(transaction.note.path, async () => {
                if (!await this.validateReadyItem(ready, transaction, item)) {
                    this.recordOutcome(ready, transaction, {
                        status: 'unapplied',
                        reason: t('notice.delegatedReferenceChanged'),
                    });
                    return;
                }
                const replacement = await this.replaceExactReference(ready, transaction, item.file!, result);
                if (!replacement) {
                    this.recordOutcome(ready, transaction, {
                        status: 'unapplied',
                        reason: t('notice.delegatedReferenceChanged'),
                    });
                    return;
                }

                if (!transaction.keepLocalCopy) await this.removeIfUnreferenced(ready, item.file!, transaction);
                this.recordOutcome(ready, transaction, { status: 'success' });
            });
        } catch {
            this.recordOutcome(ready, transaction, remoteMayExist
                ? { status: 'unapplied', reason: t('notice.delegatedReferenceChanged') }
                : { status: 'failed', reason: t('notice.delegatedUploadFailed') });
        } finally {
            transaction.activeHandoffs--;
            this.finishTransactionIfReady(ready.transactionId, transaction);
        }
    }

    private async replaceExactReference(
        ready: HandoffReadyItem,
        transaction: DelegatedTransaction,
        file: TFile,
        result: UploadOperationResult
    ): Promise<boolean> {
        if (!result.url) return false;
        const content = await this.readCurrentContent(transaction);
        const matches = this.deps.refConverter.parseReferences(content)
            .filter((reference) => this.referenceId(reference) === ready.referenceId)
            .filter((reference) => this.resolvesTo(reference, transaction.note, file));
        if (matches.length !== 1) return false;
        const match = matches[0]!;
        const vars = await this.deps.getReferenceTemplateFileVars(file, transaction.customReferenceTemplate);
        const replacement = this.deps.buildUploadedReference(result.url, vars, match.altText, transaction.customReferenceTemplate);
        if (!await this.validateReadyItem(ready, transaction, { ...transaction.items[ready.itemIndex]!, file })) return false;
        const editorContent = this.isSourceEditorActive(transaction)
            ? this.readEditorContent(transaction.editor)
            : null;
        if (editorContent === content) {
            transaction.items[ready.itemIndex]!.replacementApplied = true;
            transaction.items[ready.itemIndex]!.replacementReference = replacement;
            const start = this.offsetToPosition(content, match.col);
            const end = this.offsetToPosition(content, match.col + match.fullMatch.length);
            transaction.editor.replaceRange(replacement, start, end);
        } else {
            let replaced = false;
            transaction.items[ready.itemIndex]!.replacementApplied = true;
            transaction.items[ready.itemIndex]!.replacementReference = replacement;
            await this.deps.app.vault.process(transaction.note, (current) => {
                const currentMatches = this.deps.refConverter.parseReferences(current)
                    .filter((reference) => this.referenceId(reference) === ready.referenceId)
                    .filter((reference) => this.resolvesTo(reference, transaction.note, file));
                if (currentMatches.length !== 1) return current;
                const currentMatch = currentMatches[0]!;
                replaced = true;
                return current.substring(0, currentMatch.col) +
                    replacement +
                    current.substring(currentMatch.col + currentMatch.fullMatch.length);
            });
            if (!replaced) {
                transaction.items[ready.itemIndex]!.replacementApplied = false;
                transaction.items[ready.itemIndex]!.replacementReference = undefined;
                return false;
            }
        }
        return true;
    }

    private async removeIfUnreferenced(
        ready: HandoffReadyItem,
        file: TFile,
        transaction: DelegatedTransaction
    ): Promise<void> {
        if (!await this.waitForProtection(ready, file, transaction)) return;
        const sourceContent = await this.readCurrentContent(transaction);
        const result = await scanLocalOrphans(
            this.deps.app,
            this.deps.getSettings().supportedExtensions,
            new Map([[transaction.note.path, sourceContent]])
        );
        if (!result.orphans.some((orphan) => orphan.path === file.path)) return;
        if (!await this.validatePostReplacement(ready, transaction, transaction.items[ready.itemIndex]!)) return;
        const fresh = await scanLocalOrphans(
            this.deps.app,
            this.deps.getSettings().supportedExtensions,
            new Map([[transaction.note.path, await this.readCurrentContent(transaction)]])
        );
        if (!fresh.orphans.some((orphan) => orphan.path === file.path)) return;
        if (this.deps.isIndeterminate(file)) return;
        if (!await this.validatePostReplacement(ready, transaction, transaction.items[ready.itemIndex]!)) return;
        await this.deps.app.fileManager.trashFile(file);
    }

    private waitForProtection(
        ready: HandoffReadyItem,
        file: TFile,
        transaction: DelegatedTransaction
    ): Promise<boolean> {
        if (!transaction.releasedProtections.has(ready.fileId)) {
            transaction.releasedProtections.add(ready.fileId);
            this.deps.endIndeterminate(file);
        }
        return new Promise((resolve) => {
            const timer = window.setTimeout(() => {
                transaction.protectionWaits.delete(timer);
                resolve(
                    !this.deps.isIndeterminate(file) &&
                    this.validatePostReplacementState(ready, transaction, transaction.items[ready.itemIndex]!)
                );
            }, 2_000);
            transaction.protectionWaits.set(timer, { itemIndex: ready.itemIndex, resolve });
        });
    }

    private resolvesTo(reference: ImageReference, note: TFile, file: TFile): boolean {
        return this.deps.app.metadataCache.getFirstLinkpathDest(reference.path, note.path) === file;
    }

    private async validateReadyItem(
        ready: HandoffReadyItem,
        transaction: DelegatedTransaction,
        item: DelegatedItem
    ): Promise<boolean> {
        if (!this.validateItemIdentity(ready, transaction, item)) return false;
        if (!this.coordinator.isCurrent(ready.transactionId, ready.itemIndex, ready.referenceId)) return false;
        const content = await this.readCurrentContent(transaction);
        const matches = this.deps.refConverter.parseReferences(content)
            .filter((reference) => this.referenceId(reference) === ready.referenceId)
            .filter((reference) => this.resolvesTo(reference, transaction.note, item.file!));
        return matches.length === 1;
    }

    private async validatePostReplacement(
        ready: HandoffReadyItem,
        transaction: DelegatedTransaction,
        item: DelegatedItem
    ): Promise<boolean> {
        if (!this.validatePostReplacementState(ready, transaction, item)) return false;
        if (!item.replacementReference) return false;
        const content = await this.readCurrentContent(transaction);
        const occurrences = content.split(item.replacementReference).length - 1;
        return occurrences === 1 && this.validateItemIdentity(ready, transaction, item);
    }

    private validatePostReplacementState(
        ready: HandoffReadyItem,
        transaction: DelegatedTransaction,
        item: DelegatedItem
    ): boolean {
        return !transaction.outcomes[ready.itemIndex] && this.validateItemIdentity(ready, transaction, item);
    }

    private validateItemIdentity(
        ready: HandoffReadyItem,
        transaction: DelegatedTransaction,
        item: DelegatedItem
    ): boolean {
        if (this.transactions.get(ready.transactionId) !== transaction) return false;
        if (!item.file || item.fileId !== ready.fileId || item.referenceId !== ready.referenceId) return false;
        if (!this.isSettingsSnapshotCurrent(transaction) || item.file.path !== ready.filePath) return false;
        return this.deps.app.vault.getAbstractFileByPath(item.file.path) === item.file;
    }

    private async readCurrentContent(transaction: DelegatedTransaction): Promise<string> {
        const view = this.findSourceView(transaction);
        return view
            ? this.readEditorContent(transaction.editor) ?? await this.deps.app.vault.read(transaction.note)
            : await this.deps.app.vault.read(transaction.note);
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

    private countReferenceIds(references: readonly ImageReference[]): Map<string, number> {
        const counts = new Map<string, number>();
        for (const reference of references) {
            const id = this.referenceId(reference);
            counts.set(id, (counts.get(id) ?? 0) + 1);
        }
        return counts;
    }

    private transactionReferences(
        transaction: DelegatedTransaction,
        references: readonly ImageReference[]
    ): ImageReference[] {
        const remainingBaseline = new Map(transaction.baselineReferenceCounts);
        return references.filter((reference) => {
            const id = this.referenceId(reference);
            const remaining = remainingBaseline.get(id) ?? 0;
            if (remaining === 0) return true;
            remainingBaseline.set(id, remaining - 1);
            return false;
        });
    }

    private safelyResolveReferences(id: string, transaction: DelegatedTransaction): void {
        void this.resolveReferences(id, transaction).catch(() => {
            if (this.transactions.get(id) === transaction) this.coordinator.cancel(id, 'ambiguous');
        });
    }

    private offsetToPosition(content: string, offset: number): { line: number; ch: number } {
        const before = content.substring(0, offset);
        const lines = before.split('\n');
        return { line: lines.length - 1, ch: lines[lines.length - 1]!.length };
    }

    private isSettingsSnapshotCurrent(transaction: DelegatedTransaction): boolean {
        const settings = this.deps.getSettings();
        const hosting = this.deps.getDefaultHostingConfig();
        return Boolean(hosting) && this.settingsFingerprint(settings, hosting!) === transaction.settingsFingerprint;
    }

    private settingsFingerprint(settings: ImageManagerSettings, hosting: ImageHostingConfig): string {
        return JSON.stringify({
            localManagementMode: settings.localManagementMode,
            autoUploadOnPaste: settings.autoUploadOnPaste,
            defaultHostingId: settings.defaultHostingId,
            hosting,
            keepLocalCopy: settings.keepLocalCopy,
            compressBeforeUpload: settings.compressBeforeUpload,
            compressQuality: settings.compressQuality,
            uploadPathTemplate: settings.uploadPathTemplate,
            customReferenceTemplate: settings.customReferenceTemplate,
        });
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

    private isSourceEditorActive(transaction: DelegatedTransaction): boolean {
        return this.findSourceView(transaction) !== null;
    }

    private findSourceView(transaction: DelegatedTransaction): MarkdownView | null {
        for (const leaf of this.deps.app.workspace.getLeavesOfType('markdown')) {
            const view = leaf.view;
            if (view instanceof MarkdownView && view.file?.path === transaction.note.path && view.editor === transaction.editor) {
                return view;
            }
        }
        return null;
    }

    private getFileId(file: TFile): string {
        const existing = this.fileIds.get(file);
        if (existing) return existing;
        const id = `file-${this.nextFileId++}`;
        this.fileIds.set(file, id);
        this.filesById.set(id, file);
        return id;
    }

    private applyClaims(id: string, transaction: DelegatedTransaction, claims: readonly DelegatedItemClaim[]): void {
        for (const claim of claims) {
            const file = this.filesById.get(claim.fileId);
            if (!file) continue;
            const item = transaction.items[claim.itemIndex]!;
            item.file = file;
            item.fileId = claim.fileId;
            item.referenceId = claim.referenceId;
            item.moved = transaction.movedFiles.has(claim.fileId);
            transaction.matcher.claim(claim);
            this.claimedFileOwners.set(claim.fileId, id);
            this.coordinator.observeCandidate(id, claim.itemIndex, claim.fileId, claim.filePath);
        }
    }

    private handleCancellation(cancellation: PasteLifecycleCancellation): void {
        const transaction = this.transactions.get(cancellation.transactionId);
        if (!transaction) return;
        this.cancelProtectionWaits(transaction);
        for (let index = 0; index < transaction.outcomes.length; index++) {
            if (!transaction.outcomes[index]) {
                transaction.outcomes[index] = cancellation.reason === 'timeout'
                    ? { status: 'failed', reason: t('notice.delegatedUploadTimedOut') }
                    : cancellation.reason === 'ambiguous'
                        ? { status: 'failed', reason: t('notice.delegatedReferenceChanged') }
                        : { status: 'cancelled' };
            }
        }
        this.finishTransactionIfReady(cancellation.transactionId, transaction);
    }

    private handleItemCancellation(cancellation: PasteLifecycleItemCancellation): void {
        const transaction = this.transactions.get(cancellation.transactionId);
        if (!transaction) return;
        this.cancelProtectionWaits(transaction, cancellation.itemIndex);
        transaction.outcomes[cancellation.itemIndex] = cancellation.reason === 'cancelled' || cancellation.reason === 'unload'
            ? { status: 'cancelled' }
            : { status: 'failed', reason: t('notice.delegatedReferenceChanged') };
        this.finishTransactionIfReady(cancellation.transactionId, transaction);
    }

    private recordOutcome(
        ready: HandoffReadyItem,
        transaction: DelegatedTransaction,
        outcome: DelegatedTransactionOutcome
    ): void {
        const existing = transaction.outcomes[ready.itemIndex];
        if (!existing || outcome.status === 'unapplied') transaction.outcomes[ready.itemIndex] = outcome;
        if (this.coordinator.isCurrent(ready.transactionId, ready.itemIndex, ready.referenceId)) {
            this.coordinator.complete(ready.transactionId, ready.itemIndex);
        }
    }

    private finishTransactionIfReady(id: string, transaction: DelegatedTransaction): void {
        if (transaction.noticeFinished || transaction.activeHandoffs > 0 || transaction.outcomes.some((outcome) => !outcome)) return;
        transaction.noticeFinished = true;
        this.transactions.delete(id);
        for (const timer of transaction.resolveTimers) window.clearTimeout(timer);
        transaction.resolveTimers.clear();
        for (const fileId of transaction.protectedFiles) {
            const file = this.filesById.get(fileId);
            if (file && !transaction.releasedProtections.has(fileId)) this.deps.endIndeterminate(file);
            if (this.claimedFileOwners.get(fileId) === id) this.claimedFileOwners.delete(fileId);
            const stillObserved = Array.from(this.transactions.values())
                .some((other) => other.matcher.observesCandidate(fileId));
            if (!stillObserved) this.filesById.delete(fileId);
        }
        const summary = summarizeDelegatedTransaction(transaction.outcomes as DelegatedTransactionOutcome[]);
        if (summary.kind === 'success') {
            this.deps.notice(t('notice.delegatedUploadSuccess'), 3000);
            return;
        }
        if (summary.kind === 'silent') return;
        this.deps.notice(t('notice.delegatedUploadSummary', {
            success: String(summary.success),
            cancelled: String(summary.cancelled),
            failed: String(summary.failed),
            reason: summary.reason ?? t('notice.delegatedUploadFailed'),
        }), 7000);
    }

    private cancelProtectionWaits(transaction: DelegatedTransaction, itemIndex?: number): void {
        for (const [timer, wait] of transaction.protectionWaits) {
            if (itemIndex !== undefined && wait.itemIndex !== itemIndex) continue;
            window.clearTimeout(timer);
            wait.resolve(false);
            transaction.protectionWaits.delete(timer);
        }
    }
}
