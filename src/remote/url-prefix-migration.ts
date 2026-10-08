import { TFile } from 'obsidian';
import type { App } from 'obsidian';
import { MD_IMAGE_REGEX } from '../constants';
import { normalizePublicUrlBase } from '../uploaders/public-url';
import { trimTrailingUrlPunctuation } from './object-reference-matcher';
import { readNoteSnapshot, writeNoteSnapshot } from '../utils/note-content';
import { getNotesInScope, type NoteScope } from '../utils/note-scope';

export interface UrlReplacement {
    start: number;
    end: number;
    original: string;
    replacement: string;
}

export interface UrlPrefixMigrationPlan {
    fromBase: string;
    toBase: string;
    totalNotes: number;
    notePaths: string[];
    referenceCount: number;
}

export interface UrlPrefixMigrationResult {
    totalNotes: number;
    migratedNotes: number;
    migratedReferences: number;
    conflicts: number;
    failedNotes: number;
}

/**
 * Find URL prefixes in a single note's content that match fromBase and rewrite them to toBase,
 * preserving the object path, query, and fragment. Matching requires both an exact origin and a
 * path-segment boundary so a base like `a.com` never matches `a.com.evil.com` and `/obs-notes`
 * never matches `/obs-notes2`.
 */
function buildUrlReplacement(
    urlText: string,
    fromOrigin: string,
    fromPathname: string,
    toNorm: string,
): string | null {
    let url: URL;
    try {
        url = new URL(urlText);
    } catch {
        return null;
    }
    if (url.origin !== fromOrigin) return null;
    if (url.pathname !== fromPathname && !url.pathname.startsWith(`${fromPathname}/`)) return null;
    return `${toNorm}${url.pathname.slice(fromPathname.length)}${url.search}${url.hash}`;
}

export function findUrlPrefixReplacements(
    content: string,
    fromBase: string,
    toBase: string,
): UrlReplacement[] {
    const fromNorm = normalizePublicUrlBase(fromBase);
    const toNorm = normalizePublicUrlBase(toBase);
    if (!fromNorm || !toNorm || fromNorm === toNorm) return [];

    let fromUrl: URL;
    try {
        fromUrl = new URL(fromNorm);
    } catch {
        return [];
    }
    const fromOrigin = fromUrl.origin;
    const fromPathname = fromUrl.pathname.replace(/\/+$/, '');

    const replacements: UrlReplacement[] = [];
    const coveredRanges: Array<{ start: number; end: number }> = [];

    // Markdown image references get exact URL positions so adjacent references are never merged.
    const mdImagePattern = new RegExp(MD_IMAGE_REGEX.source, 'g');
    let match: RegExpExecArray | null;
    while ((match = mdImagePattern.exec(content)) !== null) {
        const alt = match[1] ?? '';
        const urlText = match[2] ?? '';
        const start = match.index + alt.length + 4;
        const replacement = buildUrlReplacement(urlText, fromOrigin, fromPathname, toNorm);
        if (replacement !== null) {
            replacements.push({ start, end: start + urlText.length, original: urlText, replacement });
            coveredRanges.push({ start: match.index, end: match.index + match[0].length });
        }
    }

    // Remaining URLs (links, HTML, frontmatter, wiki wrappers, raw) via the broad URL scan.
    const urlPattern = /https?:\/\/[^\s<>"']+/gi;
    while ((match = urlPattern.exec(content)) !== null) {
        if (coveredRanges.some((range) => match!.index >= range.start && match!.index < range.end)) continue;
        const trimmed = trimTrailingUrlPunctuation(match[0]);
        if (!trimmed) continue;
        const replacement = buildUrlReplacement(trimmed, fromOrigin, fromPathname, toNorm);
        if (replacement !== null) {
            replacements.push({ start: match.index, end: match.index + trimmed.length, original: trimmed, replacement });
        }
    }

    replacements.sort((a, b) => a.start - b.start);
    return replacements;
}

/** Apply replacements from back to front so earlier offsets stay valid. */
export function applyUrlReplacements(content: string, replacements: readonly UrlReplacement[]): string {
    let result = content;
    for (let index = replacements.length - 1; index >= 0; index--) {
        const replacement = replacements[index]!;
        result = result.slice(0, replacement.start) + replacement.replacement + result.slice(replacement.end);
    }
    return result;
}

/** A changed, non-empty URL base offers a migration; equal or empty bases have nothing to migrate. */
export function shouldOfferUrlPrefixMigration(previousBase: string, nextBase: string): boolean {
    const fromNorm = normalizePublicUrlBase(previousBase);
    const toNorm = normalizePublicUrlBase(nextBase);
    return fromNorm.length > 0 && toNorm.length > 0 && fromNorm !== toNorm;
}

/** Resolve the base to migrate from: the current-session original wins, then the persisted previous base. */
export function resolveMigrationFromBase(originalUrlPrefix: string, previousUrlPrefix: string | undefined): string {
    const original = originalUrlPrefix.trim();
    return original || (previousUrlPrefix ?? '').trim();
}

/** Persist the previous non-empty base: an original non-empty value replaces it, clearing keeps it. */
export function nextPreviousUrlPrefix(originalUrlPrefix: string, previousUrlPrefix: string | undefined): string | undefined {
    return originalUrlPrefix.trim() ? originalUrlPrefix : previousUrlPrefix;
}

/** Previews and safely rewrites the public URL base in a fixed note scope without cross-file atomicity. */
export class UrlPrefixMigration {
    private busy = false;
    get isBusy(): boolean { return this.busy; }

    constructor(private readonly app: App) {}

    async preview(scope: NoteScope, fromBase: string, toBase: string): Promise<UrlPrefixMigrationPlan> {
        const notes = getNotesInScope(this.app, scope);
        const notePaths: string[] = [];
        let referenceCount = 0;
        for (const note of notes) {
            try {
                const content = (await readNoteSnapshot(this.app, note)).content;
                const replacements = findUrlPrefixReplacements(content, fromBase, toBase);
                if (replacements.length > 0) {
                    notePaths.push(note.path);
                    referenceCount += replacements.length;
                }
            } catch {
                // Skip notes that cannot be read for the preview; execution re-validates each note.
            }
        }
        return { fromBase, toBase, totalNotes: notes.length, notePaths, referenceCount };
    }

    async migrate(plan: UrlPrefixMigrationPlan): Promise<UrlPrefixMigrationResult> {
        if (this.busy) throw new Error('A URL prefix migration is already running');
        this.busy = true;
        try {
            const summary: UrlPrefixMigrationResult = {
                totalNotes: plan.notePaths.length,
                migratedNotes: 0,
                migratedReferences: 0,
                conflicts: 0,
                failedNotes: 0,
            };
            for (const path of plan.notePaths) {
                const file = this.app.vault.getAbstractFileByPath(path);
                if (!(file instanceof TFile)) {
                    summary.failedNotes++;
                    continue;
                }
                try {
                    const snapshot = await readNoteSnapshot(this.app, file);
                    const replacements = findUrlPrefixReplacements(snapshot.content, plan.fromBase, plan.toBase);
                    if (replacements.length === 0) continue;
                    const updated = applyUrlReplacements(snapshot.content, replacements);
                    const write = await writeNoteSnapshot(this.app, file, snapshot, updated);
                    if (write === 'applied') {
                        summary.migratedNotes++;
                        summary.migratedReferences += replacements.length;
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
