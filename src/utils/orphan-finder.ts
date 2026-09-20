import { type App, TFile } from "obsidian";
import { ImageScanner } from "./image-scanner";
import { buildLocalReferenceIndex } from "./local-reference-index";

export interface OrphanResult {
    orphans: TFile[];
    indeterminate: TFile[];
    total: number;
    referenced: number;
}

export class OrphanFinder {
    private scanner: ImageScanner;

    constructor(
        private readonly app: App,
        private readonly supportedExtensions: string[],
    ) {
        this.scanner = new ImageScanner(app, supportedExtensions);
    }

    /** Find images with neither a reliable local reference nor an ambiguous candidate. */
    async findOrphans(
        contentOverrides: ReadonlyMap<string, string> = new Map(),
    ): Promise<OrphanResult> {
        const allImages = this.scanner.getAllImages();
        const index = await buildLocalReferenceIndex(
            this.app,
            this.supportedExtensions,
            contentOverrides,
        );
        const referencedPaths = new Set(index.occurrencesByImagePath.keys());
        const indeterminatePaths = new Set(
            index.indeterminate.map((file) => file.path),
        );
        const orphans = allImages.filter(
            (file) =>
                !referencedPaths.has(file.path) &&
                !indeterminatePaths.has(file.path),
        );

        return {
            orphans,
            indeterminate: index.indeterminate,
            total: allImages.length,
            referenced:
                allImages.length - orphans.length - index.indeterminate.length,
        };
    }

    /** Return every reliably resolved occurrence, grouped by source Markdown/Canvas file. */
    async getReferencingNotes(
        file: TFile,
    ): Promise<Array<{ path: string; lines: number[] }>> {
        const index = await buildLocalReferenceIndex(
            this.app,
            this.supportedExtensions,
        );
        const occurrences = index.occurrencesByImagePath.get(file.path) ?? [];
        const linesByPath = new Map<string, number[]>();
        for (const occurrence of occurrences) {
            const lines = linesByPath.get(occurrence.sourcePath) ?? [];
            lines.push(occurrence.line);
            linesByPath.set(occurrence.sourcePath, lines);
        }
        return Array.from(linesByPath, ([path, lines]) => ({ path, lines }));
    }
}
