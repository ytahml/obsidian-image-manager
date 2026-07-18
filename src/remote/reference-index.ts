import { App } from 'obsidian';
import { RefConverter } from '../utils/ref-converter';
import {
    createRemoteObjectReferenceLookup,
    indexRemoteReference,
    type IndexedRemoteReference,
} from './object-reference-matcher';
import type {
    RemoteObjectReferenceLookup,
    RemoteReferenceIndexState,
    RemoteReferenceScanSummary,
    RemoteUrlMapping,
} from './types';

export interface RemoteReferenceScanOptions {
    signal?: AbortSignal;
}

interface Snapshot {
    summary: RemoteReferenceScanSummary;
    references: IndexedRemoteReference[];
}

/** On-demand, Markdown-only index of remote references in the current Vault. */
export class RemoteReferenceIndex {
    private snapshot: Snapshot | null = null;
    private isStale = false;
    private revision = 0;

    constructor(
        private app: App,
        private refConverter: RefConverter,
        private now: () => number = Date.now
    ) {}

    async scan(options: RemoteReferenceScanOptions = {}): Promise<RemoteReferenceScanSummary> {
        const scanRevision = this.revision;
        const references: IndexedRemoteReference[] = [];
        const files = this.app.vault.getMarkdownFiles();

        for (const file of files) {
            throwIfAborted(options.signal);
            const content = await this.app.vault.cachedRead(file);
            throwIfAborted(options.signal);
            collectReferences(content, this.refConverter, references);
        }

        throwIfAborted(options.signal);
        if (scanRevision !== this.revision) {
            throw new Error('Vault changed while scanning remote references');
        }

        const summary: RemoteReferenceScanSummary = {
            scannedAt: this.now(),
            markdownFileCount: files.length,
            referencedCount: references.filter((reference) => reference.kind === 'referenced').length,
            possiblyReferencedCount: references.filter((reference) => reference.kind === 'possibly-referenced').length,
            unmappableCount: references.filter((reference) => !reference.pathSegments).length,
        };
        this.snapshot = { summary, references };
        this.isStale = false;
        return summary;
    }

    invalidate() {
        this.revision++;
        if (this.snapshot) this.isStale = true;
    }

    getState(): RemoteReferenceIndexState {
        if (!this.snapshot) return { status: 'empty' };
        return this.isStale
            ? { status: 'stale', summary: this.snapshot.summary }
            : { status: 'fresh', summary: this.snapshot.summary };
    }

    createLookup(mapping: RemoteUrlMapping): RemoteObjectReferenceLookup {
        return createRemoteObjectReferenceLookup(mapping, this.snapshot?.references ?? [], {
            isComplete: this.snapshot !== null && !this.isStale,
        });
    }
}

function collectReferences(
    content: string,
    refConverter: RefConverter,
    references: IndexedRemoteReference[]
) {
    const imageReferenceRanges: Array<{ start: number; end: number }> = [];
    for (const reference of refConverter.parseReferences(content)) {
        if (reference.format !== 'markdown') continue;
        imageReferenceRanges.push({ start: reference.col, end: reference.col + reference.fullMatch.length });
        const indexed = indexRemoteReference(reference.path, 'referenced');
        if (indexed) references.push(indexed);
    }

    const urlPattern = /https?:\/\/[^\s<>"']+/gi;
    let match: RegExpExecArray | null;
    while ((match = urlPattern.exec(content)) !== null) {
        if (imageReferenceRanges.some((range) => match!.index >= range.start && match!.index < range.end)) {
            continue;
        }
        const indexed = indexRemoteReference(trimTrailingUrlPunctuation(match[0]), 'possibly-referenced');
        if (indexed) references.push(indexed);
    }
}

function trimTrailingUrlPunctuation(value: string): string {
    let result = value.replace(/[.,;:!?]+$/, '');
    while (result.endsWith(')') && countCharacters(result, ')') > countCharacters(result, '(')) {
        result = result.slice(0, -1);
    }
    while (result.endsWith(']') && countCharacters(result, ']') > countCharacters(result, '[')) {
        result = result.slice(0, -1);
    }
    return result;
}

function countCharacters(value: string, character: string): number {
    return [...value].filter((item) => item === character).length;
}

function throwIfAborted(signal?: AbortSignal) {
    if (signal?.aborted) throw new Error('Remote reference scan was aborted');
}
