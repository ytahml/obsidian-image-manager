import type { App, TFile } from 'obsidian';
import type { RefConverter } from '../utils/ref-converter';
import { makePublicUrlReadable } from '../utils/public-url';
import {
    renderCustomReference,
    resolveReferenceTemplateFileVars,
    type ReferenceTemplateFileVars,
} from '../utils/reference-template';
import { shouldReplaceLocalImageReference } from '../utils/upload-reference';

export interface PreparedUploadReference {
    render(url: string, altText?: string): string;
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

    async prepare(file: TFile, template = this.options.getDefaultTemplate()): Promise<PreparedUploadReference> {
        const fileVars = await resolveReferenceTemplateFileVars(
            template,
            file,
            () => this.options.getImageInfo(file),
            (error) => this.options.onImageInfoError?.(file, error)
        );
        return new PreparedReference(template, fileVars);
    }

    async replaceVaultReferences(
        imageFile: TFile,
        newUrl: string,
        prepared: PreparedUploadReference,
        options: ReplaceVaultReferenceOptions = {}
    ): Promise<number> {
        let totalReplaced = 0;

        for (const mdFile of this.options.app.vault.getMarkdownFiles()) {
            if (options.skipFile?.path === mdFile.path) continue;
            const content = await this.options.app.vault.cachedRead(mdFile);
            const refs = this.options.refConverter.parseReferences(content);
            let newContent = content;
            let replaced = false;

            for (let i = refs.length - 1; i >= 0; i--) {
                const ref = refs[i]!;
                if (!shouldReplaceLocalImageReference(ref.path, imageFile.name, imageFile.path)) continue;
                const replacement = prepared.render(newUrl, ref.altText);
                newContent = newContent.substring(0, ref.col) + replacement +
                    newContent.substring(ref.col + ref.fullMatch.length);
                replaced = true;
                totalReplaced++;
            }

            if (replaced) await this.options.app.vault.process(mdFile, () => newContent);
        }

        return totalReplaced;
    }
}

class PreparedReference implements PreparedUploadReference {
    constructor(
        private readonly template: string,
        private readonly fileVars: ReferenceTemplateFileVars
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
