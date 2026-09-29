import type { App } from 'obsidian';
import type { RefConverter } from './ref-converter';
import { readNoteSnapshot, writeNoteSnapshot } from './note-content';
import { getNotesInScope, type NoteScope } from './note-scope';

export interface ScopedReferenceConversionResult {
    totalNotes: number;
    convertedNotes: number;
    convertedReferences: number;
    skippedReferences: number;
    conflicts: number;
    failedNotes: number;
}

/** Safely converts Wiki image references in a fixed note scope without cross-file atomicity. */
export class ScopedReferenceConversion {
    private busy = false;
    get isBusy(): boolean { return this.busy; }

    constructor(private readonly app: App, private readonly converter: RefConverter) {}

    async convert(scope: NoteScope): Promise<ScopedReferenceConversionResult> {
        if (this.busy) throw new Error('A reference conversion is already running');
        this.busy = true;
        try {
            const notes = getNotesInScope(this.app, scope);
            const summary: ScopedReferenceConversionResult = {
                totalNotes: notes.length,
                convertedNotes: 0,
                convertedReferences: 0,
                skippedReferences: 0,
                conflicts: 0,
                failedNotes: 0,
            };
            for (const note of notes) {
                try {
                    const snapshot = await readNoteSnapshot(this.app, note);
                    const result = this.converter.convertAllReferences(snapshot.content, 'markdown', note);
                    summary.skippedReferences += result.skipped;
                    if (result.converted === 0) continue;
                    const write = await writeNoteSnapshot(this.app, note, snapshot, result.content);
                    if (write === 'applied') {
                        summary.convertedNotes++;
                        summary.convertedReferences += result.converted;
                    } else if (write === 'conflict') {
                        summary.conflicts++;
                    }
                } catch {
                    summary.failedNotes++;
                }
            }
            return summary;
        } finally {
            this.busy = false;
        }
    }
}
