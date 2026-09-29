import type { App, TFile } from "obsidian";
import type { RefConverter } from "../utils/ref-converter";
import { readNoteSnapshot, writeNoteSnapshot } from "../utils/note-content";
import { isUploadSourceCurrent, type UploadSource } from "./upload-scope";
import { makePublicUrlReadable } from "../utils/public-url";
import {
    renderCustomReference,
    resolveReferenceTemplateFileVars,
    type ReferenceTemplateFileVars,
} from "../utils/reference-template";
import {
    createLocalFileLookup,
    resolveLocalFileReference,
} from "../utils/local-image-resolution";

export interface PreparedUploadReference {
    render(url: string, altText?: string): string;
}

export interface UploadedReference {
    source: UploadSource;
    url: string;
    prepared: PreparedUploadReference;
}
export interface BatchReferenceResult {
    updatedNotes: number;
    replacedReferences: number;
    outsideScopeNotes: number;
    failures: Array<{ notePath: string; reason: 'conflict' | 'read-or-write-failed' }>;
}

export interface ReplaceVaultReferenceOptions {
    skipFile?: TFile;
}

export interface UploadReferenceManagerOptions {
    app: App;
    refConverter: RefConverter;
    getDefaultTemplate: () => string;
    getImageInfo: (file: TFile) => Promise<{ width: number; height: number }>;
    onImageInfoError?: (file: TFile, error: unknown) => void;
}

/** Owns uploaded-reference rendering and ordinary Vault-wide replacement. */
export class UploadReferenceManager {
    constructor(private readonly options: UploadReferenceManagerOptions) {}

    async prepare(
        file: TFile,
        template = this.options.getDefaultTemplate(),
    ): Promise<PreparedUploadReference> {
        const fileVars = await resolveReferenceTemplateFileVars(
            template,
            file,
            () => this.options.getImageInfo(file),
            (error) => this.options.onImageInfoError?.(file, error),
        );
        return new PreparedReference(template, fileVars);
    }

    /** One pass over Markdown; each note is written at most once, against live content. */
    async replaceBatchReferences(
        uploads: readonly UploadedReference[],
        scopeNotes: ReadonlySet<string>,
    ): Promise<BatchReferenceResult> {
        const result: BatchReferenceResult = { updatedNotes: 0, replacedReferences: 0, outsideScopeNotes: 0, failures: [] };
        if (!uploads.length) return result;
        const app = this.options.app;
        const byPath = new Map(uploads.map(upload => [upload.source.path, upload]));
        const lookup = createLocalFileLookup(app.vault.getFiles());
        for (const note of app.vault.getMarkdownFiles()) {
            try {
                const snapshot = await readNoteSnapshot(app, note);
                const refs = this.options.refConverter.parseReferences(snapshot.content);
                let content = snapshot.content;
                let count = 0;
                const used = new Set<UploadedReference>();
                for (let i = refs.length - 1; i >= 0; i--) {
                    const ref = refs[i]!;
                    const resolution = resolveLocalFileReference(app, note, ref.path, ref.format, lookup);
                    if (resolution.status !== 'resolved') continue;
                    const upload = byPath.get(resolution.file.path);
                    if (!upload || resolution.file !== upload.source.file || !isUploadSourceCurrent(app, upload.source)) continue;
                    const text = upload.prepared.render(upload.url, ref.altText);
                    content = content.substring(0, ref.col) + text + content.substring(ref.col + ref.fullMatch.length);
                    used.add(upload);
                    count++;
                }
                if (!count) continue;
                const status = await writeNoteSnapshot(app, note, snapshot, content,
                    () => Array.from(used).every(upload => isUploadSourceCurrent(app, upload.source)));
                if (status === 'conflict') result.failures.push({ notePath: snapshot.path, reason: 'conflict' });
                if (status === 'applied') {
                    result.updatedNotes++;
                    result.replacedReferences += count;
                    if (!scopeNotes.has(snapshot.path)) result.outsideScopeNotes++;
                }
            } catch {
                result.failures.push({ notePath: note.path, reason: 'read-or-write-failed' });
            }
        }
        return result;
    }

    async replaceVaultReferences(
        imageFile: TFile,
        newUrl: string,
        prepared: PreparedUploadReference,
        options: ReplaceVaultReferenceOptions = {},
    ): Promise<number> {
        let totalReplaced = 0;
        const lookup = createLocalFileLookup(this.options.app.vault.getFiles());

        for (const mdFile of this.options.app.vault.getMarkdownFiles()) {
            if (options.skipFile?.path === mdFile.path) continue;
            const content = await this.options.app.vault.cachedRead(mdFile);
            const refs = this.options.refConverter.parseReferences(content);
            let newContent = content;
            let replaced = false;

            for (let i = refs.length - 1; i >= 0; i--) {
                const ref = refs[i]!;
                const resolution = resolveLocalFileReference(
                    this.options.app,
                    mdFile,
                    ref.path,
                    ref.format,
                    lookup,
                );
                if (
                    resolution.status !== "resolved" ||
                    resolution.file.path !== imageFile.path
                )
                    continue;
                const replacement = prepared.render(newUrl, ref.altText);
                newContent =
                    newContent.substring(0, ref.col) +
                    replacement +
                    newContent.substring(ref.col + ref.fullMatch.length);
                replaced = true;
                totalReplaced++;
            }

            if (replaced)
                await this.options.app.vault.process(mdFile, () => newContent);
        }

        return totalReplaced;
    }
}

class PreparedReference implements PreparedUploadReference {
    constructor(
        private readonly template: string,
        private readonly fileVars: ReferenceTemplateFileVars,
    ) {}

    render(url: string, altText?: string): string {
        const baseName = altText || this.fileVars.fileBaseName;
        const readableUrl = makePublicUrlReadable(url);
        const customReference = renderCustomReference(this.template, {
            fileUrl: readableUrl,
            fileAlt: baseName,
            ...this.fileVars,
        });
        return customReference ?? `![${baseName}](${readableUrl})`;
    }
}
