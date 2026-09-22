import { TFile, type App } from "obsidian";
import {
    createLocalFileLookup,
    resolveLocalFileReference,
} from "./local-image-resolution";
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

type TargetSemantics = "markdown" | "wiki" | "url" | "literal";

interface ReferenceCandidate {
    kind: LocalReferenceKind;
    target: string;
    index: number;
    semantics: TargetSemantics;
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
    const imageLookup = createLocalFileLookup(images);

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
        if (!candidates) {
            for (const image of images) indeterminate.set(image.path, image);
            continue;
        }
        for (const candidate of candidates) {
            const target = normalizeTarget(
                candidate.target,
                candidate.semantics,
            );
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
            const resolution = resolveLocalFileReference(
                app,
                source,
                target,
                candidate.semantics,
                imageLookup,
            );
            if (resolution.status === "resolved") {
                const occurrences =
                    occurrencesByImagePath.get(resolution.file.path) ?? [];
                occurrences.push(occurrence);
                occurrencesByImagePath.set(resolution.file.path, occurrences);
            } else if (resolution.status === "ambiguous") {
                for (const image of resolution.candidates)
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
            candidates.push({
                kind: "wiki",
                target,
                index: match.index,
                semantics: "wiki",
            });
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
            candidates.push({
                kind: "markdown",
                target,
                index: match.index,
                semantics: "markdown",
            });
    }
    HTML_ATTRIBUTE.lastIndex = 0;
    while ((match = HTML_ATTRIBUTE.exec(text)) !== null) {
        candidates.push({
            kind: "html",
            target: decodeHtmlEntities(match[1] ?? match[2] ?? match[3] ?? ""),
            index: match.index,
            semantics: "url",
        });
    }
    HTML_SRCSET.lastIndex = 0;
    while ((match = HTML_SRCSET.exec(text)) !== null) {
        const value = decodeHtmlEntities(
            match[1] ?? match[2] ?? match[3] ?? "",
        );
        for (const target of splitSrcset(value))
            candidates.push({
                kind: "html",
                target,
                index: match.index,
                semantics: "url",
            });
    }

    // YAML is intentionally treated as data, not a schema: only image-looking scalar values become candidates.
    const frontmatter = /^---\s*\n([\s\S]*?)\n---\s*(?:\n|$)/.exec(text);
    if (frontmatter) {
        const offset =
            frontmatter.index + frontmatter[0].indexOf(frontmatter[1] ?? "");
        const imageValue =
            /(?:^|[\s:["'[])([^\s,"'\][]+\.(?:png|jpe?g|gif|bmp|svg|webp|ico|tiff?|avif)(?:[?#][^\s,"'\][]*)?)/gi;
        const quotedImageValue =
            /"([^"\r\n]*?\.(?:png|jpe?g|gif|bmp|svg|webp|ico|tiff?|avif)(?:[?#][^"\r\n]*)?)"|'([^'\r\n]*?\.(?:png|jpe?g|gif|bmp|svg|webp|ico|tiff?|avif)(?:[?#][^'\r\n]*)?)'/gi;
        const unquotedScalarImageValue =
            /^\s*(?:[^:#\r\n]+:\s*|-\s+)([^"'[\]{},\r\n].*?\.(?:png|jpe?g|gif|bmp|svg|webp|ico|tiff?|avif)(?:[?#]\S*)?)\s*(?:\s+#.*)?$/gim;
        const structuredRanges: Array<{ start: number; end: number }> = [];
        let imageMatch: RegExpExecArray | null;
        const yaml = frontmatter[1] ?? "";
        while ((imageMatch = quotedImageValue.exec(yaml)) !== null) {
            const target = imageMatch[1] ?? imageMatch[2] ?? "";
            structuredRanges.push({
                start: imageMatch.index,
                end: imageMatch.index + imageMatch[0].length,
            });
            candidates.push({
                kind: "frontmatter",
                target,
                index: offset + imageMatch.index + 1,
                semantics: "url",
            });
        }
        while ((imageMatch = unquotedScalarImageValue.exec(yaml)) !== null) {
            const target = (imageMatch[1] ?? "").trim();
            const targetIndex =
                imageMatch.index + imageMatch[0].indexOf(target);
            structuredRanges.push({
                start: targetIndex,
                end: targetIndex + target.length,
            });
            candidates.push({
                kind: "frontmatter",
                target,
                index: offset + targetIndex,
                semantics: "url",
            });
        }
        while ((imageMatch = imageValue.exec(yaml)) !== null) {
            const target = imageMatch[1] ?? "";
            const targetIndex =
                imageMatch.index + imageMatch[0].lastIndexOf(target);
            if (
                structuredRanges.some(
                    (range) =>
                        targetIndex >= range.start && targetIndex < range.end,
                )
            )
                continue;
            candidates.push({
                kind: "frontmatter",
                target,
                index: offset + targetIndex,
                semantics: "url",
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
        const label = text.slice(openingBracket + 1, closingBracket);
        let destinationStart = closingBracket + 1;
        while (/\s/.test(text[destinationStart] ?? "")) destinationStart++;
        if (text[destinationStart] !== "(") {
            index = label.includes("![") ? openingBracket : closingBracket;
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
                semantics: "markdown",
            });
        index = label.includes("![") ? openingBracket : closingParen;
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

function collectCanvasCandidates(text: string): ReferenceCandidate[] | null {
    try {
        const parsed: unknown = JSON.parse(text);
        if (!parsed || typeof parsed !== "object") return null;
        const nodes = (parsed as { nodes?: unknown }).nodes;
        if (!Array.isArray(nodes)) return null;
        const candidates: ReferenceCandidate[] = [];
        for (const node of nodes) {
            if (!node || typeof node !== "object") continue;
            const record = node as { file?: unknown; text?: unknown };
            if (typeof record.file === "string")
                candidates.push({
                    kind: "canvas",
                    target: record.file,
                    index: text.indexOf(record.file),
                    semantics: "literal",
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
        return null;
    }
}

function splitWikiTarget(value: string): string {
    const separator = value.search(/\\?\|/);
    return (separator === -1 ? value : value.slice(0, separator)).trim();
}

function normalizeTarget(target: string, semantics: TargetSemantics): string {
    const trimmed = target.trim();
    if (!trimmed || semantics === "literal") return trimmed;
    const withoutSuffix = stripUnescapedSuffix(trimmed, semantics === "wiki");
    return semantics === "markdown"
        ? decodeMarkdownEscapes(withoutSuffix)
        : withoutSuffix;
}

function stripUnescapedSuffix(value: string, fragmentOnly: boolean): string {
    for (let index = 0; index < value.length; index++) {
        if (value[index] === "\\") {
            index++;
            continue;
        }
        if (value[index] === "#" || (!fragmentOnly && value[index] === "?"))
            return value.slice(0, index);
    }
    return value;
}

function decodeMarkdownEscapes(value: string): string {
    let result = "";
    for (let index = 0; index < value.length; index++) {
        const current = value[index] ?? "";
        const next = value[index + 1];
        if (current === "\\" && next && isAsciiPunctuation(next)) {
            result += next;
            index++;
        } else result += current;
    }
    return result;
}

function isAsciiPunctuation(value: string): boolean {
    const code = value.charCodeAt(0);
    return (
        (code >= 0x21 && code <= 0x2f) ||
        (code >= 0x3a && code <= 0x40) ||
        (code >= 0x5b && code <= 0x60) ||
        (code >= 0x7b && code <= 0x7e)
    );
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
    return value.replace(
        /&(?:#x([0-9a-f]+)|#([0-9]+)|(amp|quot|apos));/gi,
        (
            entity,
            hexadecimal: string | undefined,
            decimal: string | undefined,
            named: string | undefined,
        ) => {
            if (named) {
                if (named.toLowerCase() === "amp") return "&";
                if (named.toLowerCase() === "quot") return '"';
                return "'";
            }
            const codePoint = Number.parseInt(
                hexadecimal ?? decimal ?? "",
                hexadecimal ? 16 : 10,
            );
            if (
                !Number.isFinite(codePoint) ||
                codePoint <= 0 ||
                codePoint > 0x10ffff ||
                (codePoint >= 0xd800 && codePoint <= 0xdfff)
            )
                return entity;
            return String.fromCodePoint(codePoint);
        },
    );
}

function splitSrcset(value: string): string[] {
    const entries: string[] = [];
    let index = 0;
    while (index < value.length) {
        while (/[\s,]/.test(value[index] ?? "")) index++;
        const start = index;
        while (index < value.length && !/\s/.test(value[index] ?? "")) index++;
        const rawUrl = value.slice(start, index);
        const url = rawUrl.replace(/,+$/, "");
        if (url) entries.push(url);
        if (url.length < rawUrl.length) continue;
        while (index < value.length && value[index] !== ",") index++;
        if (value[index] === ",") index++;
    }
    return entries;
}

function lineAt(text: string, index: number): number {
    if (index < 0) return 0;
    return text.slice(0, index).split("\n").length - 1;
}
