import { App, TFile } from "obsidian";
import type {
    ImageManagerSettings,
    ImageReference,
    ReferenceFormat,
} from "../types";
import {
    createLocalFileLookup,
    resolveLocalFileReference,
    type LocalFileLookup,
} from "./local-image-resolution";
import { joinPath, encodePathSegments } from "./path-utils";
import { RefConverter } from "./ref-converter";
import { isRemoteImageReference } from "./upload-reference";

export interface ReorganizeResult {
    moved: number;
    skipped: number;
}

interface BoundReference {
    reference: ImageReference;
    file: TFile;
}

interface PlannedMove {
    file: TFile;
    originalPath: string;
    finalPath: string;
}

interface NoteReferenceSnapshot {
    file: TFile;
    content: string;
    references: Array<{ reference: ImageReference; originalImagePath: string }>;
}

export class ImageReorganizer {
    private app: App;
    private refConverter: RefConverter;
    private settings: ImageManagerSettings;
    private resolveImagePath: (
        template: string,
        currentFile: TFile | null,
        filename: string,
    ) => string;

    constructor(
        app: App,
        settings: ImageManagerSettings,
        resolveImagePath: (
            template: string,
            currentFile: TFile | null,
            filename: string,
        ) => string,
    ) {
        this.app = app;
        this.refConverter = new RefConverter(app);
        this.settings = settings;
        this.resolveImagePath = resolveImagePath;
    }

    /** 整理单篇笔记引用的图片 */
    async reorganizeNote(
        noteFile: TFile,
        convertFormat?: ReferenceFormat,
    ): Promise<ReorganizeResult> {
        const content = await this.app.vault.cachedRead(noteFile);
        const refs = this.refConverter.parseReferences(content);
        const imageLookup = this.createImageLookup();
        const boundReferences: BoundReference[] = [];
        let skipped = 0;

        for (const ref of refs) {
            if (isRemoteImageReference(ref.path)) continue;
            if (
                this.settings.skipWikiRefsOnReorganize &&
                ref.format === "wiki"
            ) {
                skipped++;
                continue;
            }

            const resolution = resolveLocalFileReference(
                this.app,
                noteFile,
                ref.path,
                ref.format,
                imageLookup,
            );
            if (resolution.status !== "resolved") {
                skipped++;
                continue;
            }
            boundReferences.push({ reference: ref, file: resolution.file });
        }

        const moves = this.planMoves(noteFile, boundReferences);
        const movedPaths = new Set(
            Array.from(moves.values())
                .filter((move) => move.originalPath !== move.finalPath)
                .map((move) => move.originalPath),
        );
        const otherNotes = await this.bindOtherNoteReferences(
            noteFile,
            movedPaths,
            imageLookup,
        );

        // Do not start moving files if the source note changed while the plan was built.
        if ((await this.app.vault.cachedRead(noteFile)) !== content) {
            return { moved: 0, skipped: skipped + boundReferences.length };
        }

        let moved = 0;
        for (const move of moves.values()) {
            if (move.originalPath === move.finalPath) continue;
            const targetDir = move.finalPath.substring(
                0,
                move.finalPath.lastIndexOf("/"),
            );
            await this.ensureDirectory(targetDir);
            await this.app.vault.rename(move.file, move.finalPath);
            moved++;
        }

        const currentReplacements = boundReferences.map(
            ({ reference, file }) => {
                const move = moves.get(this.originalPathFor(file, moves));
                const finalPath = move?.finalPath ?? file.path;
                return {
                    reference,
                    text: this.buildReference(
                        reference,
                        finalPath,
                        noteFile,
                        convertFormat ?? reference.format,
                    ),
                };
            },
        );
        await this.writeSnapshot(noteFile, content, currentReplacements);

        for (const snapshot of otherNotes) {
            const replacements = snapshot.references.map(
                ({ reference, originalImagePath }) => {
                    const move = moves.get(originalImagePath)!;
                    return {
                        reference,
                        text: this.buildReference(
                            reference,
                            move.finalPath,
                            snapshot.file,
                            reference.format,
                        ),
                    };
                },
            );
            await this.writeSnapshot(
                snapshot.file,
                snapshot.content,
                replacements,
            );
        }

        return { moved, skipped };
    }

    /** 整理文件夹内所有笔记引用的图片 */
    async reorganizeFolder(
        folderPath: string,
        convertFormat?: ReferenceFormat,
    ): Promise<ReorganizeResult & { notes: number }> {
        const prefix = folderPath ? `${folderPath}/` : "";
        const mdFiles = this.app.vault
            .getMarkdownFiles()
            .filter(
                (file) =>
                    !folderPath ||
                    file.path === folderPath ||
                    file.path.startsWith(prefix),
            );

        let totalMoved = 0;
        let totalSkipped = 0;
        let notesProcessed = 0;

        for (const mdFile of mdFiles) {
            const result = await this.reorganizeNote(mdFile, convertFormat);
            totalMoved += result.moved;
            totalSkipped += result.skipped;
            if (result.moved > 0 || result.skipped > 0) {
                notesProcessed++;
            }
        }

        return {
            moved: totalMoved,
            skipped: totalSkipped,
            notes: notesProcessed,
        };
    }

    private createImageLookup(): LocalFileLookup {
        return createLocalFileLookup(
            this.app.vault.getFiles().filter((file) => this.isImageFile(file)),
        );
    }

    private planMoves(
        noteFile: TFile,
        references: readonly BoundReference[],
    ): Map<string, PlannedMove> {
        const moves = new Map<string, PlannedMove>();
        const reservedPaths = new Set<string>();

        // Preserve the previous reverse-reference ordering for conflict suffix assignment.
        for (let index = references.length - 1; index >= 0; index--) {
            const file = references[index]!.file;
            if (moves.has(file.path)) continue;

            const targetDir = this.resolveImagePath(
                this.settings.imagePathTemplate || "attachments",
                noteFile,
                file.name,
            );
            const targetPath = joinPath(targetDir, file.name);
            const finalPath =
                file.path === targetPath
                    ? file.path
                    : this.ensureUniquePath(targetPath, reservedPaths);
            reservedPaths.add(finalPath);
            moves.set(file.path, { file, originalPath: file.path, finalPath });
        }

        return moves;
    }

    private async bindOtherNoteReferences(
        excludeNote: TFile,
        movedPaths: ReadonlySet<string>,
        imageLookup: LocalFileLookup,
    ): Promise<NoteReferenceSnapshot[]> {
        if (movedPaths.size === 0) return [];
        const snapshots: NoteReferenceSnapshot[] = [];
        const mdFiles = this.app.vault
            .getMarkdownFiles()
            .filter((file) => file.path !== excludeNote.path);

        for (const mdFile of mdFiles) {
            const content = await this.app.vault.cachedRead(mdFile);
            const references: NoteReferenceSnapshot["references"] = [];
            for (const reference of this.refConverter.parseReferences(
                content,
            )) {
                if (isRemoteImageReference(reference.path)) continue;
                const resolution = resolveLocalFileReference(
                    this.app,
                    mdFile,
                    reference.path,
                    reference.format,
                    imageLookup,
                );
                if (
                    resolution.status === "resolved" &&
                    movedPaths.has(resolution.file.path)
                ) {
                    references.push({
                        reference,
                        originalImagePath: resolution.file.path,
                    });
                }
            }
            if (references.length > 0)
                snapshots.push({ file: mdFile, content, references });
        }

        return snapshots;
    }

    private originalPathFor(
        file: TFile,
        moves: ReadonlyMap<string, PlannedMove>,
    ): string {
        for (const [originalPath, move] of moves) {
            if (move.file === file) return originalPath;
        }
        return file.path;
    }

    private buildReference(
        reference: ImageReference,
        vaultPath: string,
        noteFile: TFile,
        format: ReferenceFormat,
    ): string {
        if (format === "wiki") {
            const fileName = vaultPath.split("/").pop() ?? vaultPath;
            return reference.altText
                ? `![[${fileName}|${reference.altText}]]`
                : `![[${fileName}]]`;
        }

        const noteDir = noteFile.parent?.path ?? "";
        const refPath = this.buildRefPath(vaultPath, format, noteDir);
        return `![${reference.altText}](${refPath})`;
    }

    private isImageFile(file: TFile): boolean {
        return this.settings.supportedExtensions.includes(
            file.extension.toLowerCase(),
        );
    }

    private buildRefPath(
        vaultPath: string,
        format: "wiki" | "markdown",
        noteDir?: string,
    ): string {
        if (format === "wiki") {
            return vaultPath.split("/").pop() ?? vaultPath;
        }
        let refPath = vaultPath;
        if (noteDir && this.settings.imagePathBase === "note") {
            refPath = this.refConverter.computeRelativePath(noteDir, vaultPath);
        }
        return encodePathSegments(refPath);
    }

    private async ensureDirectory(dirPath: string): Promise<void> {
        if (!dirPath) return;
        const parts = dirPath.split("/");
        let current = "";
        for (const part of parts) {
            current = current ? `${current}/${part}` : part;
            if (!this.app.vault.getAbstractFileByPath(current)) {
                await this.app.vault.createFolder(current).catch(() => {});
            }
        }
    }

    private ensureUniquePath(
        filePath: string,
        reservedPaths: ReadonlySet<string> = new Set(),
    ): string {
        if (
            !this.app.vault.getAbstractFileByPath(filePath) &&
            !reservedPaths.has(filePath)
        ) {
            return filePath;
        }

        const ext = filePath.split(".").pop() ?? "";
        const baseName = filePath.replace(new RegExp(`\\.${ext}$`), "");
        let counter = 1;
        let newPath = `${baseName}-${counter}.${ext}`;

        while (
            this.app.vault.getAbstractFileByPath(newPath) ||
            reservedPaths.has(newPath)
        ) {
            counter++;
            newPath = `${baseName}-${counter}.${ext}`;
        }

        return newPath;
    }

    private async writeSnapshot(
        file: TFile,
        originalContent: string,
        replacements: ReadonlyArray<{
            reference: ImageReference;
            text: string;
        }>,
    ): Promise<void> {
        if (
            replacements.every(
                ({ reference, text }) => reference.fullMatch === text,
            )
        )
            return;

        await this.app.vault.process(file, (currentContent) => {
            if (currentContent !== originalContent) return currentContent;
            let updated = currentContent;
            const ordered = [...replacements].sort(
                (a, b) => b.reference.col - a.reference.col,
            );
            for (const { reference, text } of ordered) {
                if (text === reference.fullMatch) continue;
                if (
                    updated.slice(
                        reference.col,
                        reference.col + reference.fullMatch.length,
                    ) !== reference.fullMatch
                ) {
                    return currentContent;
                }
                updated =
                    updated.substring(0, reference.col) +
                    text +
                    updated.substring(
                        reference.col + reference.fullMatch.length,
                    );
            }
            return updated;
        });
    }
}
