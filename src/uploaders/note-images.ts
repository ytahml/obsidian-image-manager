import type { App, TFile } from "obsidian";
import type { ImageReference, ReferenceFormat } from "../types";
import type { RefConverter } from "../utils/ref-converter";
import {
    createLocalFileLookup,
    resolveLocalFileReference,
    type LocalFileLookup,
    type LocalFileResolution,
} from "../utils/local-image-resolution";
import { readNoteContentForAction } from "../utils/note-content";

export interface LocalNoteImageReference {
    reference: ImageReference;
    resolution: LocalFileResolution;
}

export interface LocalNoteImages {
    content: string;
    references: LocalNoteImageReference[];
}

/** Resolve a local image link using Obsidian semantics, with conservative legacy fallbacks. */
export function resolveLocalImageReference(
    app: App,
    noteFile: TFile,
    refPath: string,
    format: ReferenceFormat = "markdown",
    lookup: LocalFileLookup = createLocalFileLookup(app.vault.getFiles()),
): LocalFileResolution {
    return resolveLocalFileReference(app, noteFile, refPath, format, lookup);
}

/** Read the selected note and resolve every local image reference for upload. */
export async function collectLocalNoteImages(
    app: App,
    noteFile: TFile,
    refConverter: RefConverter,
): Promise<LocalNoteImages> {
    const content = await readNoteContentForAction(app, noteFile);
    const lookup = createLocalFileLookup(app.vault.getFiles());
    const references = refConverter
        .parseReferences(content)
        .map((reference) => ({
            reference,
            resolution: resolveLocalImageReference(
                app,
                noteFile,
                reference.path,
                reference.format,
                lookup,
            ),
        }))
        .filter((item) => item.resolution.status !== "remote");
    return { content, references };
}
