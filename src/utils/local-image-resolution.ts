import { normalizePath, TFile } from "obsidian";
import type { App } from "obsidian";
import type { ReferenceFormat } from "../types";
import { decodePathSegments } from "./path-utils";

export type LocalReferenceSemantics = ReferenceFormat | "url" | "literal";

export interface LocalFileLookup {
    byPath: ReadonlyMap<string, TFile>;
    byName: ReadonlyMap<string, readonly TFile[]>;
}

export type LocalFileResolution =
    | { status: "resolved"; file: TFile }
    | { status: "missing" }
    | { status: "ambiguous"; candidates: readonly TFile[] };

export function createLocalFileLookup(
    files: readonly TFile[],
): LocalFileLookup {
    const byPath = new Map<string, TFile>();
    const byName = new Map<string, TFile[]>();

    for (const file of files) {
        byPath.set(file.path, file);
        const sameName = byName.get(file.name) ?? [];
        sameName.push(file);
        byName.set(file.name, sameName);
    }

    for (const sameName of byName.values()) {
        sameName.sort((a, b) => a.path.localeCompare(b.path));
    }

    return { byPath, byName };
}

export function resolveLocalFileReference(
    app: App,
    source: TFile,
    rawTarget: string,
    semantics: LocalReferenceSemantics,
    lookup: LocalFileLookup,
): LocalFileResolution {
    const target = normalizeLinkTarget(rawTarget, semantics);
    if (!target) return { status: "missing" };

    const linked = app.metadataCache?.getFirstLinkpathDest(target, source.path);
    if (linked instanceof TFile) {
        const eligible = lookup.byPath.get(linked.path);
        if (eligible) return { status: "resolved", file: eligible };
    }

    for (const path of explicitCandidatePaths(source, target)) {
        const file = lookup.byPath.get(path);
        if (file) return { status: "resolved", file };
    }

    const filename = target.split("/").pop() ?? target;
    const sameName = lookup.byName.get(filename) ?? [];
    if (sameName.length === 1)
        return { status: "resolved", file: sameName[0]! };
    if (sameName.length > 1)
        return { status: "ambiguous", candidates: sameName };
    return { status: "missing" };
}

function normalizeLinkTarget(
    rawTarget: string,
    semantics: LocalReferenceSemantics,
): string {
    if (semantics === "wiki" || semantics === "literal") return rawTarget;
    return decodePathSegments(unwrapMarkdownDestination(rawTarget));
}

function unwrapMarkdownDestination(path: string): string {
    const trimmed = path.trim();
    if (trimmed.startsWith("<") && trimmed.endsWith(">")) {
        return trimmed.slice(1, -1);
    }
    return trimmed;
}

function explicitCandidatePaths(source: TFile, target: string): string[] {
    if (target.startsWith("/")) return [normalizePath(target.slice(1))];

    const noteDir =
        source.parent?.path ??
        source.path.slice(0, source.path.lastIndexOf("/"));
    const candidates = new Set<string>([normalizePath(target)]);
    candidates.add(resolveRelativePath(noteDir, target));
    return Array.from(candidates);
}

function resolveRelativePath(noteDir: string, target: string): string {
    const parts = noteDir.split("/").filter(Boolean);
    for (const part of target.split("/").filter(Boolean)) {
        if (part === "..") parts.pop();
        else if (part !== ".") parts.push(part);
    }
    return normalizePath(parts.join("/"));
}
