import { normalizePath, TFile } from 'obsidian';
import type { App } from 'obsidian';
import type { ImageReference } from '../types';
import type { RefConverter } from '../utils/ref-converter';
import { decodePathSegments } from '../utils/path-utils';
import { readNoteContentForAction } from '../utils/note-content';
import { isRemoteImageReference } from '../utils/upload-reference';

export interface LocalNoteImageReference {
    reference: ImageReference;
    file: TFile | null;
}

export interface LocalNoteImages {
    content: string;
    references: LocalNoteImageReference[];
}

function unwrapMarkdownDestination(path: string): string {
    const trimmed = path.trim();
    if (trimmed.startsWith('<') && trimmed.endsWith('>')) {
        return trimmed.slice(1, -1);
    }
    return trimmed;
}

function resolveRelativePath(noteDir: string, path: string): string {
    const parts = noteDir.split('/').filter(Boolean);
    for (const part of path.split('/').filter(Boolean)) {
        if (part === '..') parts.pop();
        else if (part !== '.') parts.push(part);
    }
    return normalizePath(parts.join('/'));
}

/** Resolve a local image link using Obsidian semantics, with legacy vault-root fallbacks. */
export function resolveLocalImageReference(app: App, noteFile: TFile, refPath: string): TFile | null {
    const decodedPath = decodePathSegments(unwrapMarkdownDestination(refPath));

    const linkedFile = app.metadataCache.getFirstLinkpathDest(decodedPath, noteFile.path);
    if (linkedFile instanceof TFile) return linkedFile;

    const noteDir = noteFile.parent?.path ?? '';
    const candidates: string[] = [];
    if (decodedPath.startsWith('/')) {
        candidates.push(normalizePath(decodedPath.slice(1)));
    } else {
        candidates.push(normalizePath(decodedPath));
        candidates.push(resolveRelativePath(noteDir, decodedPath));
    }

    for (const candidate of candidates) {
        const file = app.vault.getAbstractFileByPath(candidate);
        if (file instanceof TFile) return file;
    }

    const filename = decodedPath.split('/').pop() ?? decodedPath;
    return app.vault.getFiles().find((file) => file.name === filename) ?? null;
}

/** Read the selected note and resolve every local image reference for upload. */
export async function collectLocalNoteImages(
    app: App,
    noteFile: TFile,
    refConverter: RefConverter
): Promise<LocalNoteImages> {
    const content = await readNoteContentForAction(app, noteFile);
    const references = refConverter
        .parseReferences(content)
        .filter((reference) => !isRemoteImageReference(reference.path))
        .map((reference) => ({
            reference,
            file: resolveLocalImageReference(app, noteFile, reference.path),
        }));
    return { content, references };
}
