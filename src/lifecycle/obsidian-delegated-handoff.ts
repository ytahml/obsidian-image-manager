import { Notice, TFile, type App, type Editor } from 'obsidian';
import type { ImageHostingConfig, ImageManagerSettings, ImageReference } from '../types';
import type { ReferenceTemplateFileVars } from '../utils/reference-template';
import { RefConverter } from '../utils/ref-converter';
import { scanLocalOrphans } from '../utils/local-orphan-management';
import { PasteLifecycleCoordinator, type HandoffReadyItem, type PasteLifecycleCancellation } from './paste-lifecycle';
import type { UploadOperationResult, UploadService } from '../uploaders/upload-service';

interface DelegatedItem {
    file?: TFile;
    moved: boolean;
}

interface DelegatedTransaction {
    note: TFile;
    editor: Editor;
    items: DelegatedItem[];
    hosting: ImageHostingConfig;
    keepLocalCopy: boolean;
    completedItems: number;
}

export interface DelegatedHandoffDependencies {
    app: App;
    getSettings: () => ImageManagerSettings;
    uploadService: UploadService;
    refConverter: RefConverter;
    isImageFile: (file: TFile) => boolean;
    buildUploadedReference: (url: string, vars: ReferenceTemplateFileVars, alt?: string) => string;
    getReferenceTemplateFileVars: (file: TFile) => Promise<ReferenceTemplateFileVars>;
    getDefaultHostingConfig: () => ImageHostingConfig | null;
    notice: (message: string, timeout?: number) => Notice;
}

/** Obsidian adapter for the pure delegated paste lifecycle coordinator. */
export class ObsidianDelegatedHandoff {
    private readonly coordinator: PasteLifecycleCoordinator;
    private readonly transactions = new Map<string, DelegatedTransaction>();

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
            return;
        }
    }

    onRename(file: TFile): void {
        for (const [id, transaction] of this.transactions) {
            const index = transaction.items.findIndex((item) => item.file === file);
            if (index < 0) continue;
            transaction.items[index]!.moved = true;
            this.coordinator.observeCandidate(id, index, file.path, file.path);
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
            this.coordinator.observeReference(
                id,
                index,
                item.file.path,
                this.referenceId(reference),
                item.moved
            );
        }
    }

    private async handoff(ready: HandoffReadyItem): Promise<void> {
        const transaction = this.transactions.get(ready.transactionId);
        const item = transaction?.items[ready.itemIndex];
        if (!transaction || !item?.file) return;
        if (this.deps.getSettings().localManagementMode !== 'delegated' ||
            !this.deps.getSettings().autoUploadOnPaste ||
            !this.isHostingStillEnabled(transaction.hosting)) {
            this.completeItem(ready.transactionId, transaction);
            return;
        }

        const result = await this.deps.uploadService.uploadFile(item.file, transaction.hosting, { maxRetries: 2 });
        if (!result.success || !result.url) {
            this.deps.notice('Automatic upload failed. Use an explicit upload command to retry.', 5000);
            this.completeItem(ready.transactionId, transaction);
            return;
        }

        const replacement = await this.replaceExactReference(transaction, item.file, result);
        if (!replacement) {
            this.deps.notice('Upload completed, but the reference changed. The local file was kept and the remote object may be unused.', 6000);
            this.completeItem(ready.transactionId, transaction);
            return;
        }

        if (!transaction.keepLocalCopy) await this.removeIfUnreferenced(item.file);
        this.deps.notice('Image uploaded and the pasted reference was replaced.', 3000);
        this.completeItem(ready.transactionId, transaction);
    }

    private async replaceExactReference(
        transaction: DelegatedTransaction,
        file: TFile,
        result: UploadOperationResult
    ): Promise<boolean> {
        if (!result.url) return false;
        const content = await this.readCurrentContent(transaction);
        const matches = this.deps.refConverter.parseReferences(content)
            .filter((reference) => this.resolvesTo(reference, transaction.note, file));
        if (matches.length !== 1) return false;
        const match = matches[0]!;
        const vars = await this.deps.getReferenceTemplateFileVars(file);
        const replacement = this.deps.buildUploadedReference(result.url, vars, match.altText);
        const editorContent = this.readEditorContent(transaction.editor);
        if (editorContent === content) {
            const start = this.offsetToPosition(content, match.col);
            const end = this.offsetToPosition(content, match.col + match.fullMatch.length);
            transaction.editor.replaceRange(replacement, start, end);
        } else {
            await this.deps.app.vault.process(transaction.note, (current) => {
                const currentMatches = this.deps.refConverter.parseReferences(current)
                    .filter((reference) => this.resolvesTo(reference, transaction.note, file));
                if (currentMatches.length !== 1) return current;
                const currentMatch = currentMatches[0]!;
                return current.substring(0, currentMatch.col) +
                    replacement +
                    current.substring(currentMatch.col + currentMatch.fullMatch.length);
            });
        }
        return true;
    }

    private async removeIfUnreferenced(file: TFile): Promise<void> {
        const result = await scanLocalOrphans(this.deps.app, this.deps.getSettings().supportedExtensions);
        if (!result.orphans.some((orphan) => orphan.path === file.path)) return;
        await this.deps.app.fileManager.trashFile(file);
    }

    private resolvesTo(reference: ImageReference, note: TFile, file: TFile): boolean {
        return this.deps.app.metadataCache.getFirstLinkpathDest(reference.path, note.path) === file;
    }

    private async readCurrentContent(transaction: DelegatedTransaction): Promise<string> {
        return this.readEditorContent(transaction.editor) ?? await this.deps.app.vault.cachedRead(transaction.note);
    }

    private readEditorContent(editor: Editor): string | null {
        try {
            return editor.getValue();
        } catch {
            return null;
        }
    }

    private referenceId(reference: ImageReference): string {
        return `${reference.col}:${reference.fullMatch}`;
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

    private completeItem(transactionId: string, transaction: DelegatedTransaction): void {
        transaction.completedItems++;
        if (transaction.completedItems >= transaction.items.length) this.transactions.delete(transactionId);
    }

    private handleCancellation(cancellation: PasteLifecycleCancellation): void {
        this.transactions.delete(cancellation.transactionId);
        if (cancellation.reason === 'timeout') {
            this.deps.notice('Automatic upload timed out. The local file and reference were kept.', 5000);
        }
    }
}
