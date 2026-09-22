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

export interface ReorganizeResult {
    moved: number;
    skipped: number;
}

export type ReorganizationErrorCode =
    | "concurrent-change"
    | "execution-failed"
    | "rollback-failed";

export class ReorganizationError extends Error {
    constructor(
        readonly code: ReorganizationErrorCode,
        message: string,
    ) {
        super(message);
        this.name = "ReorganizationError";
    }
}

interface BoundReference {
    reference: ImageReference;
    file: TFile;
}

interface PlannedMove {
    file: TFile;
    originalPath: string;
    targetPath: string;
    finalPath: string;
}

interface NoteContentSnapshot {
    file: TFile;
    content: string;
}

interface NoteReferenceSnapshot extends NoteContentSnapshot {
    references: BoundReference[];
    isTarget: boolean;
    skipped: number;
    convertFormat?: ReferenceFormat;
}

interface OtherNoteSnapshots {
    affectedNotes: NoteReferenceSnapshot[];
    barrierNotes: NoteContentSnapshot[];
}

interface ReorganizationPlan {
    targetNotes: NoteReferenceSnapshot[];
    affectedNotes: NoteReferenceSnapshot[];
    barrierNotes: NoteContentSnapshot[];
    moves: Map<string, PlannedMove>;
    skipped: number;
}

interface NoteWriteJournalEntry {
    file: TFile;
    originalContent: string;
    updatedContent: string;
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
        const plan = await this.buildPlan([noteFile], convertFormat);
        return this.executePlan(plan);
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
        const plan = await this.buildPlan(mdFiles, convertFormat);
        const result = await this.executePlan(plan);
        return {
            ...result,
            notes: this.countProcessedNotes(plan),
        };
    }

    private async buildPlan(
        noteFiles: readonly TFile[],
        convertFormat?: ReferenceFormat,
    ): Promise<ReorganizationPlan> {
        const imageLookup = this.createImageLookup();
        const targetNotes: NoteReferenceSnapshot[] = [];

        for (const noteFile of noteFiles) {
            targetNotes.push(
                await this.bindTargetNote(noteFile, convertFormat, imageLookup),
            );
        }

        const moves = this.planMoves(targetNotes);
        const movedPaths = new Set(
            Array.from(moves.values())
                .filter((move) => move.originalPath !== move.finalPath)
                .map((move) => move.originalPath),
        );
        const targetPaths = new Set(targetNotes.map((note) => note.file.path));
        const otherNotes = await this.bindOtherNoteReferences(
            targetPaths,
            movedPaths,
            imageLookup,
        );

        return {
            targetNotes,
            affectedNotes: [...targetNotes, ...otherNotes.affectedNotes],
            barrierNotes: [...targetNotes, ...otherNotes.barrierNotes],
            moves,
            skipped: targetNotes.reduce(
                (total, note) => total + note.skipped,
                0,
            ),
        };
    }

    private async bindTargetNote(
        noteFile: TFile,
        convertFormat: ReferenceFormat | undefined,
        imageLookup: LocalFileLookup,
    ): Promise<NoteReferenceSnapshot> {
        const content = await this.app.vault.cachedRead(noteFile);
        const references: BoundReference[] = [];
        let skipped = 0;

        for (const reference of this.refConverter.parseReferences(content)) {
            const resolution = resolveLocalFileReference(
                this.app,
                noteFile,
                reference.path,
                reference.format,
                imageLookup,
            );
            if (resolution.status === "remote") continue;
            if (
                this.settings.skipWikiRefsOnReorganize &&
                reference.format === "wiki"
            ) {
                skipped++;
                continue;
            }
            if (resolution.status !== "resolved") {
                skipped++;
                continue;
            }
            references.push({ reference, file: resolution.file });
        }

        return {
            file: noteFile,
            content,
            references,
            isTarget: true,
            skipped,
            convertFormat,
        };
    }

    private createImageLookup(): LocalFileLookup {
        return createLocalFileLookup(
            this.app.vault.getFiles().filter((file) => this.isImageFile(file)),
        );
    }

    private planMoves(
        targetNotes: readonly NoteReferenceSnapshot[],
    ): Map<string, PlannedMove> {
        const moves = new Map<string, PlannedMove>();

        for (const note of targetNotes) {
            for (let index = note.references.length - 1; index >= 0; index--) {
                const file = note.references[index]!.file;
                const targetDir = this.resolveImagePath(
                    this.settings.imagePathTemplate || "attachments",
                    note.file,
                    file.name,
                );
                const targetPath = joinPath(targetDir, file.name);
                const existing = moves.get(file.path);
                if (existing) {
                    existing.targetPath = targetPath;
                    existing.finalPath = targetPath;
                } else {
                    moves.set(file.path, {
                        file,
                        originalPath: file.path,
                        targetPath,
                        finalPath: targetPath,
                    });
                }
            }
        }

        const reservedPaths = new Set<string>();
        for (const move of moves.values()) {
            move.finalPath =
                move.originalPath === move.targetPath
                    ? move.originalPath
                    : this.ensureUniquePath(move.targetPath, reservedPaths);
            reservedPaths.add(move.finalPath);
        }

        return moves;
    }

    private async bindOtherNoteReferences(
        excludedPaths: ReadonlySet<string>,
        movedPaths: ReadonlySet<string>,
        imageLookup: LocalFileLookup,
    ): Promise<OtherNoteSnapshots> {
        if (movedPaths.size === 0) {
            return { affectedNotes: [], barrierNotes: [] };
        }
        const affectedNotes: NoteReferenceSnapshot[] = [];
        const barrierNotes: NoteContentSnapshot[] = [];
        const mdFiles = this.app.vault
            .getMarkdownFiles()
            .filter((file) => !excludedPaths.has(file.path));

        for (const mdFile of mdFiles) {
            const content = await this.app.vault.cachedRead(mdFile);
            barrierNotes.push({ file: mdFile, content });
            const references: BoundReference[] = [];
            for (const reference of this.refConverter.parseReferences(
                content,
            )) {
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
                        file: resolution.file,
                    });
                }
            }
            if (references.length > 0) {
                affectedNotes.push({
                    file: mdFile,
                    content,
                    references,
                    isTarget: false,
                    skipped: 0,
                });
            }
        }

        return { affectedNotes, barrierNotes };
    }

    private async executePlan(
        plan: ReorganizationPlan,
    ): Promise<ReorganizeResult> {
        await this.prepareDirectories(plan.moves);
        this.allocateFinalPaths(plan.moves);
        await this.validateMutationBarrier(plan);

        const reservedPaths = new Set(
            Array.from(plan.moves.values()).map((move) => move.finalPath),
        );
        const completedMoves: PlannedMove[] = [];
        const completedWrites: NoteWriteJournalEntry[] = [];
        try {
            for (const move of plan.moves.values()) {
                if (move.originalPath === move.finalPath) continue;
                const occupied = this.app.vault.getAbstractFileByPath(
                    move.finalPath,
                );
                if (occupied && occupied !== move.file) {
                    reservedPaths.delete(move.finalPath);
                    move.finalPath = this.ensureUniquePath(
                        move.targetPath,
                        reservedPaths,
                    );
                    reservedPaths.add(move.finalPath);
                }
                await this.app.vault.rename(move.file, move.finalPath);
                completedMoves.push(move);
            }

            for (const note of plan.affectedNotes) {
                const write = await this.writeSnapshot(
                    note.file,
                    note.content,
                    this.buildReplacements(note, plan.moves),
                );
                if (write) completedWrites.push(write);
            }
        } catch (error) {
            const rollbackErrors = await this.rollbackExecution(
                completedMoves,
                completedWrites,
            );
            if (rollbackErrors.length > 0) {
                throw new ReorganizationError(
                    "rollback-failed",
                    `Reorganization rollback was incomplete: ${rollbackErrors.join("; ")}`,
                );
            }
            if (error instanceof ReorganizationError) throw error;
            throw new ReorganizationError(
                "execution-failed",
                `Reorganization failed: ${this.errorMessage(error)}`,
            );
        }

        return { moved: completedMoves.length, skipped: plan.skipped };
    }

    private async prepareDirectories(
        moves: ReadonlyMap<string, PlannedMove>,
    ): Promise<void> {
        const directories = new Set<string>();
        for (const move of moves.values()) {
            if (move.originalPath === move.targetPath) continue;
            directories.add(
                move.targetPath.substring(0, move.targetPath.lastIndexOf("/")),
            );
        }
        for (const directory of directories) {
            await this.ensureDirectory(directory);
        }
    }

    private allocateFinalPaths(moves: Map<string, PlannedMove>): void {
        const reservedPaths = new Set<string>();
        for (const move of moves.values()) {
            move.finalPath =
                move.originalPath === move.targetPath
                    ? move.originalPath
                    : this.ensureUniquePath(move.targetPath, reservedPaths);
            reservedPaths.add(move.finalPath);
        }
    }

    private async validateMutationBarrier(
        plan: ReorganizationPlan,
    ): Promise<void> {
        for (const note of plan.barrierNotes) {
            let currentContent: string;
            try {
                if (
                    this.app.vault.getAbstractFileByPath(note.file.path) !==
                    note.file
                ) {
                    throw new Error("Note identity changed");
                }
                currentContent = await this.app.vault.cachedRead(note.file);
            } catch {
                throw new ReorganizationError(
                    "concurrent-change",
                    `Vault note changed during reorganization: ${note.file.path}`,
                );
            }
            if (currentContent !== note.content) {
                throw new ReorganizationError(
                    "concurrent-change",
                    `Vault content changed during reorganization: ${note.file.path}`,
                );
            }
        }
        for (const move of plan.moves.values()) {
            if (
                this.app.vault.getAbstractFileByPath(move.originalPath) !==
                move.file
            ) {
                throw new ReorganizationError(
                    "concurrent-change",
                    `Image changed during reorganization: ${move.originalPath}`,
                );
            }
        }
    }

    private buildReplacements(
        snapshot: NoteReferenceSnapshot,
        moves: ReadonlyMap<string, PlannedMove>,
    ): Array<{ reference: ImageReference; text: string }> {
        return snapshot.references.map(({ reference, file }) => {
            const move = this.moveForFile(file, moves);
            const finalPath = move?.finalPath ?? file.path;
            return {
                reference,
                text: this.buildReference(
                    reference,
                    finalPath,
                    snapshot.file,
                    snapshot.isTarget
                        ? (snapshot.convertFormat ?? reference.format)
                        : reference.format,
                ),
            };
        });
    }

    private moveForFile(
        file: TFile,
        moves: ReadonlyMap<string, PlannedMove>,
    ): PlannedMove | undefined {
        for (const move of moves.values()) {
            if (move.file === file) return move;
        }
        return undefined;
    }

    private countProcessedNotes(plan: ReorganizationPlan): number {
        return plan.targetNotes.filter(
            (note) =>
                note.skipped > 0 ||
                note.references.some(({ file }) => {
                    const move = this.moveForFile(file, plan.moves);
                    return move && move.originalPath !== move.finalPath;
                }) ||
                this.buildReplacements(note, plan.moves).some(
                    ({ reference, text }) => text !== reference.fullMatch,
                ),
        ).length;
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
    ): Promise<NoteWriteJournalEntry | null> {
        let updatedContent = originalContent;
        const ordered = [...replacements].sort(
            (a, b) => b.reference.col - a.reference.col,
        );
        for (const { reference, text } of ordered) {
            if (text === reference.fullMatch) continue;
            if (
                updatedContent.slice(
                    reference.col,
                    reference.col + reference.fullMatch.length,
                ) !== reference.fullMatch
            ) {
                throw new ReorganizationError(
                    "concurrent-change",
                    `Reference changed during reorganization: ${file.path}`,
                );
            }
            updatedContent =
                updatedContent.substring(0, reference.col) +
                text +
                updatedContent.substring(
                    reference.col + reference.fullMatch.length,
                );
        }
        if (updatedContent === originalContent) return null;

        let applied = false;
        let conflict = false;
        await this.app.vault.process(file, (currentContent) => {
            if (currentContent !== originalContent) {
                conflict = true;
                return currentContent;
            }
            applied = true;
            return updatedContent;
        });
        if (conflict || !applied) {
            throw new ReorganizationError(
                "concurrent-change",
                `Vault content changed during reorganization: ${file.path}`,
            );
        }
        return { file, originalContent, updatedContent };
    }

    private async rollbackExecution(
        completedMoves: readonly PlannedMove[],
        completedWrites: readonly NoteWriteJournalEntry[],
    ): Promise<string[]> {
        const errors: string[] = [];

        for (let index = completedMoves.length - 1; index >= 0; index--) {
            const move = completedMoves[index]!;
            try {
                const occupied = this.app.vault.getAbstractFileByPath(
                    move.originalPath,
                );
                if (occupied && occupied !== move.file) {
                    errors.push(`original path occupied: ${move.originalPath}`);
                    continue;
                }
                if (move.file.path !== move.originalPath) {
                    await this.app.vault.rename(move.file, move.originalPath);
                }
            } catch (error) {
                errors.push(
                    `image ${move.originalPath}: ${this.errorMessage(error)}`,
                );
            }
        }

        for (let index = completedWrites.length - 1; index >= 0; index--) {
            const write = completedWrites[index]!;
            let restored = false;
            let conflict = false;
            try {
                await this.app.vault.process(write.file, (currentContent) => {
                    if (currentContent !== write.updatedContent) {
                        conflict = true;
                        return currentContent;
                    }
                    restored = true;
                    return write.originalContent;
                });
                if (conflict || !restored) {
                    errors.push(`note changed: ${write.file.path}`);
                }
            } catch (error) {
                errors.push(
                    `note ${write.file.path}: ${this.errorMessage(error)}`,
                );
            }
        }

        return errors;
    }

    private errorMessage(error: unknown): string {
        return error instanceof Error ? error.message : String(error);
    }
}
