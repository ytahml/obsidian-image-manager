import { TFile } from 'obsidian';
import type { App } from 'obsidian';
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

interface ParsedInlineUrl {
    url: string;
    /** Offset of the URL within the parenthesized content. */
    offset: number;
}

/** Extract the exact URL from `![alt](url "title")` / `[text](<url>)` parentheses. */
function parseInlineUrl(parenContent: string): ParsedInlineUrl | null {
    const trimmed = parenContent.replace(/^\s+/, '');
    const offset = parenContent.length - trimmed.length;
    if (trimmed.startsWith('<')) {
        const close = trimmed.indexOf('>');
        if (close < 0) return null;
        return { url: trimmed.slice(1, close), offset: offset + 1 };
    }
    const match = /^[^\s]+/.exec(trimmed);
    if (!match) return null;
    return { url: match[0], offset };
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

    // Inline links and images get exact URL positions, so titles, angle brackets, and adjacent
    // references are never merged or rewritten.
    const inlinePattern = /(!?)\[([^\]]*)\]\(([^)]+)\)/g;
    let match: RegExpExecArray | null;
    while ((match = inlinePattern.exec(content)) !== null) {
        const isImage = match[1] === '!';
        const alt = match[2] ?? '';
        const parsed = parseInlineUrl(match[3] ?? '');
        coveredRanges.push({ start: match.index, end: match.index + match[0].length });
        if (!parsed) continue;
        const urlStart = match.index + (isImage ? 2 : 1) + alt.length + 2 + parsed.offset;
        const replacement = buildUrlReplacement(parsed.url, fromOrigin, fromPathname, toNorm);
        if (replacement !== null) {
            replacements.push({ start: urlStart, end: urlStart + parsed.url.length, original: parsed.url, replacement });
        }
    }

    // Remaining URLs (HTML, frontmatter, wiki wrappers, raw, reference definitions) via the broad
    // scan, skipping any match that overlaps an already-recognized inline reference.
    const urlPattern = /https?:\/\/[^\s<>"']+/gi;
    while ((match = urlPattern.exec(content)) !== null) {
        const trimmed = trimTrailingUrlPunctuation(match[0]);
        if (!trimmed) continue;
        const urlStart = match.index;
        const urlEnd = match.index + trimmed.length;
        if (coveredRanges.some((range) => urlStart < range.end && urlEnd > range.start)) continue;
        const replacement = buildUrlReplacement(trimmed, fromOrigin, fromPathname, toNorm);
        if (replacement !== null) {
            replacements.push({ start: urlStart, end: urlEnd, original: trimmed, replacement });
        }
    }

    replacements.sort((a, b) => a.start - b.start);
    // Defensive: never emit overlapping replacement ranges.
    const deduped: UrlReplacement[] = [];
    let lastEnd = -1;
    for (const replacement of replacements) {
        if (replacement.start < lastEnd) continue;
        deduped.push(replacement);
        lastEnd = replacement.end;
    }
    return deduped;
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

/** Resolve the base to migrate from: the persisted previous base wins, then the current-session original. */
export function resolveMigrationFromBase(originalUrlPrefix: string, previousUrlPrefix: string | undefined): string {
    const previous = (previousUrlPrefix ?? '').trim();
    return previous || originalUrlPrefix.trim();
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
