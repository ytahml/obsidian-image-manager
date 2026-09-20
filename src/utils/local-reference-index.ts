import { TFile, normalizePath, type App } from "obsidian";
import { decodePathSegments } from "./path-utils";
import { isRemoteImageReference } from "./upload-reference";

export type LocalReferenceKind =
    | "markdown"
    | "wiki"
    | "html"
    | "frontmatter"
    | "canvas";

export interface LocalReferenceOccurrence {
    kind: LocalReferenceKind;
    sourcePath: string;
    target: string;
    line: number;
}

export interface LocalReferenceIndex {
    occurrencesByImagePath: Map<string, LocalReferenceOccurrence[]>;
    indeterminate: TFile[];
}

interface ReferenceCandidate {
    kind: LocalReferenceKind;
    target: string;
    index: number;
}

const IMAGE_EXTENSION = /\.(?:png|jpe?g|gif|bmp|svg|webp|ico|tiff?|avif)$/i;
const WIKI_LINK = /!?\[\[([^\]]+)\]\]/g;
const HTML_ATTRIBUTE =
    /\b(?:src|href)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi;
const HTML_SRCSET = /\bsrcset\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi;
const REFERENCE_DEFINITION = /^\s{0,3}\[([^\]]+)\]:\s*(<[^>]*>|\S+)/gm;
const REFERENCE_USE = /!?\[([^\]]*)\]\[([^\]]*)\]|!?\[([^\]]+)\](?![[(])/g;

/**
 * Build a read-only, conservative index of local image use. It deliberately does
 * not return ImageReference: callers must not use these occurrences for edits.
 */
export async function buildLocalReferenceIndex(
    app: App,
    supportedExtensions: readonly string[],
    contentOverrides: ReadonlyMap<string, string> = new Map(),
): Promise<LocalReferenceIndex> {
    const supported = new Set(
        supportedExtensions.map((extension) => extension.toLowerCase()),
    );
    const files = app.vault.getFiles();
    const images = files.filter((file) =>
        supported.has(file.extension.toLowerCase()),
    );
    const byPath = new Map(images.map((file) => [file.path, file]));
    const byName = new Map<string, TFile[]>();
    for (const image of images) {
        const entries = byName.get(image.name) ?? [];
        entries.push(image);
        byName.set(image.name, entries);
    }

    const occurrencesByImagePath = new Map<
        string,
        LocalReferenceOccurrence[]
    >();
    const indeterminate = new Map<string, TFile>();
    const sourceFiles = files.filter(
        (file) =>
            file.extension.toLowerCase() === "md" ||
            file.extension.toLowerCase() === "canvas",
    );

    for (const source of sourceFiles) {
        const text =
            contentOverrides.get(source.path) ??
            (await app.vault.cachedRead(source));
        const candidates =
            source.extension.toLowerCase() === "canvas"
                ? collectCanvasCandidates(text)
                : collectMarkdownCandidates(text);
        for (const candidate of candidates) {
            const target = normalizeTarget(candidate.target, candidate.kind);
            if (
                !target ||
                isRemoteImageReference(target) ||
                !IMAGE_EXTENSION.test(target)
            )
                continue;
            const occurrence = {
                kind: candidate.kind,
                sourcePath: source.path,
                target,
                line: lineAt(text, candidate.index),
            } satisfies LocalReferenceOccurrence;
            const resolved = resolveTarget(
                app,
                source,
                target,
                byPath,
                byName,
                candidate.kind,
            );
            const image = resolved.length === 1 ? resolved[0] : undefined;
            if (image) {
                const occurrences =
                    occurrencesByImagePath.get(image.path) ?? [];
                occurrences.push(occurrence);
                occurrencesByImagePath.set(image.path, occurrences);
            } else {
                for (const image of resolved)
                    indeterminate.set(image.path, image);
            }
        }
    }

    return {
        occurrencesByImagePath,
        indeterminate: Array.from(indeterminate.values()),
    };
}

function collectMarkdownCandidates(text: string): ReferenceCandidate[] {
    const candidates: ReferenceCandidate[] = [];
    const definitions = new Map<string, string>();
    let match: RegExpExecArray | null;

    REFERENCE_DEFINITION.lastIndex = 0;
    while ((match = REFERENCE_DEFINITION.exec(text)) !== null) {
        definitions.set(
            normalizeLabel(match[1] ?? ""),
            unwrapMarkdownDestination(match[2] ?? ""),
        );
    }
    WIKI_LINK.lastIndex = 0;
    while ((match = WIKI_LINK.exec(text)) !== null) {
        const target = splitWikiTarget(match[1] ?? "");
        if (target)
            candidates.push({ kind: "wiki", target, index: match.index });
    }
    candidates.push(...collectMarkdownInlineCandidates(text));
    REFERENCE_USE.lastIndex = 0;
    while ((match = REFERENCE_USE.exec(text)) !== null) {
        const explicitLabel = match[2];
        const shortcutLabel = match[3];
        const label = normalizeLabel(
            explicitLabel === ""
                ? (match[1] ?? "")
                : (explicitLabel ?? shortcutLabel ?? ""),
        );
        const target = definitions.get(label);
        if (target)
            candidates.push({ kind: "markdown", target, index: match.index });
    }
    HTML_ATTRIBUTE.lastIndex = 0;
    while ((match = HTML_ATTRIBUTE.exec(text)) !== null) {
        candidates.push({
            kind: "html",
            target: decodeHtmlEntities(match[1] ?? match[2] ?? match[3] ?? ""),
            index: match.index,
        });
    }
    HTML_SRCSET.lastIndex = 0;
    while ((match = HTML_SRCSET.exec(text)) !== null) {
        const value = decodeHtmlEntities(
            match[1] ?? match[2] ?? match[3] ?? "",
        );
        for (const target of splitSrcset(value))
            candidates.push({ kind: "html", target, index: match.index });
    }

    // YAML is intentionally treated as data, not a schema: only image-looking scalar values become candidates.
    const frontmatter = /^---\s*\n([\s\S]*?)\n---\s*(?:\n|$)/.exec(text);
    if (frontmatter) {
        const offset =
            frontmatter.index + frontmatter[0].indexOf(frontmatter[1] ?? "");
        const imageValue =
            /(?:^|[\s:["'[])([^\s,"'\][]+\.(?:png|jpe?g|gif|bmp|svg|webp|ico|tiff?|avif)(?:[?#][^\s,"'\][]*)?)/gi;
        let imageMatch: RegExpExecArray | null;
        const yaml = frontmatter[1] ?? "";
        while ((imageMatch = imageValue.exec(yaml)) !== null) {
            candidates.push({
                kind: "frontmatter",
                target: imageMatch[1] ?? "",
                index: offset + imageMatch.index,
            });
        }
    }
    return candidates;
}

function collectMarkdownInlineCandidates(text: string): ReferenceCandidate[] {
    const candidates: ReferenceCandidate[] = [];
    for (let index = 0; index < text.length; index++) {
        const openingBracket =
            text[index] === "!" && text[index + 1] === "["
                ? index + 1
                : text[index] === "["
                  ? index
                  : -1;
        if (openingBracket === -1 || text[openingBracket + 1] === "[") continue;
        const closingBracket = findClosingDelimiter(
            text,
            openingBracket,
            "[",
            "]",
        );
        if (closingBracket === -1) continue;
        let destinationStart = closingBracket + 1;
        while (/\s/.test(text[destinationStart] ?? "")) destinationStart++;
        if (text[destinationStart] !== "(") {
            index = closingBracket;
            continue;
        }
        const closingParen = findClosingDelimiter(
            text,
            destinationStart,
            "(",
            ")",
        );
        if (closingParen === -1) continue;
        const raw = text.slice(destinationStart + 1, closingParen).trim();
        const target = raw.startsWith("<")
            ? raw.slice(1, raw.indexOf(">"))
            : (raw.split(/\s+(?=(?:"|'))/, 1)[0] ?? raw);
        if (target)
            candidates.push({
                kind: "markdown",
                target: unwrapMarkdownDestination(target),
                index,
            });
        index = closingParen;
    }
    return candidates;
}

function findClosingDelimiter(
    text: string,
    opening: number,
    start: string,
    end: string,
): number {
    let depth = 0;
    for (let index = opening; index < text.length; index++) {
        if (text[index] === "\\") {
            index++;
            continue;
        }
        if (text[index] === start) depth++;
        if (text[index] === end && --depth === 0) return index;
    }
    return -1;
}

function collectCanvasCandidates(text: string): ReferenceCandidate[] {
    try {
        const parsed: unknown = JSON.parse(text);
        if (!parsed || typeof parsed !== "object") return [];
        const nodes = (parsed as { nodes?: unknown }).nodes;
        if (!Array.isArray(nodes)) return [];
        const candidates: ReferenceCandidate[] = [];
        for (const node of nodes) {
            if (!node || typeof node !== "object") continue;
            const record = node as { file?: unknown; text?: unknown };
            if (typeof record.file === "string")
                candidates.push({
                    kind: "canvas",
                    target: record.file,
                    index: text.indexOf(record.file),
                });
            if (typeof record.text === "string")
                candidates.push(
                    ...collectMarkdownCandidates(record.text).map(
                        (candidate) => ({
                            ...candidate,
                            kind: "canvas" as const,
                        }),
                    ),
                );
        }
        return candidates;
    } catch {
        return [];
    }
}

function resolveTarget(
    app: App,
    source: TFile,
    target: string,
    byPath: ReadonlyMap<string, TFile>,
    byName: ReadonlyMap<string, TFile[]>,
    kind: LocalReferenceKind,
): TFile[] {
    const linkTarget = kind === "wiki" ? target : decodePathSegments(target);
    const metadataCache = app.metadataCache;
    const linked = metadataCache?.getFirstLinkpathDest(linkTarget, source.path);
    if (linked instanceof TFile && byPath.has(linked.path)) return [linked];

    const candidates = new Set<string>();
    if (linkTarget.startsWith("/"))
        candidates.add(normalizePath(linkTarget.slice(1)));
    else {
        candidates.add(normalizePath(linkTarget));
        const parent =
            source.parent?.path ??
            source.path.slice(0, source.path.lastIndexOf("/"));
        candidates.add(
            normalizePath([parent, linkTarget].filter(Boolean).join("/")),
        );
    }
    for (const path of candidates) {
        const file = byPath.get(path);
        if (file) return [file];
    }
    return byName.get(linkTarget.split("/").pop() ?? linkTarget) ?? [];
}

function splitWikiTarget(value: string): string {
    const separator = value.search(/\\?\|/);
    return (separator === -1 ? value : value.slice(0, separator)).trim();
}

function normalizeTarget(target: string, kind: LocalReferenceKind): string {
    const trimmed = target.trim();
    if (!trimmed) return "";
    if (kind === "wiki" || kind === "canvas")
        return trimmed.split(/(?<!%)#/, 1)[0] ?? trimmed;
    return trimmed;
}

function unwrapMarkdownDestination(value: string): string {
    const trimmed = value.trim();
    return trimmed.startsWith("<") && trimmed.endsWith(">")
        ? trimmed.slice(1, -1)
        : trimmed;
}

function normalizeLabel(value: string): string {
    return value.trim().replace(/\s+/g, " ").toLowerCase();
}

function decodeHtmlEntities(value: string): string {
    return value
        .replace(/&(?:amp|#38);/gi, "&")
        .replace(/&(?:quot|#34);/gi, '"')
        .replace(/&(?:apos|#39);/gi, "'");
}

function splitSrcset(value: string): string[] {
    const entries: string[] = [];
    let start = 0;
    let data = false;
    for (let index = 0; index < value.length; index++) {
        if (value.slice(index, index + 5).toLowerCase() === "data:")
            data = true;
        if (value[index] === "," && !data) {
            entries.push(
                value.slice(start, index).trim().split(/\s+/, 1)[0] ?? "",
            );
            start = index + 1;
        }
    }
    entries.push(value.slice(start).trim().split(/\s+/, 1)[0] ?? "");
    return entries;
}

function lineAt(text: string, index: number): number {
    if (index < 0) return 0;
    return text.slice(0, index).split("\n").length - 1;
}
