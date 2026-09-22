import { App, TFile } from "obsidian";
import type { ImageReference, ReferenceFormat } from "../types";
import { MD_IMAGE_REGEX, WIKI_IMAGE_REGEX } from "../constants";
import {
    createLocalFileLookup,
    resolveLocalFileReference,
} from "./local-image-resolution";
import { encodePathSegments } from "./path-utils";

export interface ReferenceConversionResult {
    content: string;
    converted: number;
    skipped: number;
}

interface ConvertedReference {
    text: string;
    skipped: boolean;
}

export class RefConverter {
    private app: App;

    constructor(app: App) {
        this.app = app;
    }

    /** 解析文本中的所有图片引用 */
    parseReferences(text: string): ImageReference[] {
        const refs: ImageReference[] = [];
        let match: RegExpExecArray | null;

        // Reset lastIndex
        MD_IMAGE_REGEX.lastIndex = 0;
        WIKI_IMAGE_REGEX.lastIndex = 0;

        // Parse Markdown references
        while ((match = MD_IMAGE_REGEX.exec(text)) !== null) {
            const line = text.substring(0, match.index).split("\n").length - 1;
            refs.push({
                fullMatch: match[0],
                altText: match[1] ?? "",
                path: match[2] ?? "",
                format: "markdown",
                line,
                col: match.index,
            });
        }

        // Parse Wiki references
        while ((match = WIKI_IMAGE_REGEX.exec(text)) !== null) {
            const line = text.substring(0, match.index).split("\n").length - 1;
            refs.push({
                fullMatch: match[0],
                altText: match[2] ?? "",
                path: match[1] ?? "",
                format: "wiki",
                line,
                col: match.index,
            });
        }

        // Sort by position
        refs.sort((a, b) => a.col - b.col);
        return refs;
    }

    /** 将单个引用转换为目标格式；无法安全解析时保持原引用。 */
    convertReference(
        ref: ImageReference,
        targetFormat: ReferenceFormat,
        noteFile?: TFile,
    ): string {
        const lookup = createLocalFileLookup(this.app.vault.getFiles());
        return this.convertReferenceWithLookup(
            ref,
            targetFormat,
            noteFile,
            lookup,
        ).text;
    }

    private convertReferenceWithLookup(
        ref: ImageReference,
        targetFormat: ReferenceFormat,
        noteFile: TFile | undefined,
        lookup: ReturnType<typeof createLocalFileLookup>,
    ): ConvertedReference {
        if (ref.format === targetFormat)
            return { text: ref.fullMatch, skipped: false };

        if (targetFormat === "wiki") {
            const filename = ref.path.split("/").pop() ?? ref.path;
            const baseName = filename.replace(/\.[^.]+$/, "");
            const text =
                ref.altText && ref.altText !== baseName
                    ? `![[${filename}|${ref.altText}]]`
                    : `![[${filename}]]`;
            return { text, skipped: false };
        }

        const resolvedPath = this.resolveImagePath(ref.path, noteFile, lookup);
        if (!resolvedPath) return { text: ref.fullMatch, skipped: true };

        let displayPath = resolvedPath;
        if (noteFile) {
            const noteDir = noteFile.parent?.path ?? "";
            if (noteDir) {
                displayPath = this.computeRelativePath(noteDir, resolvedPath);
            }
        }
        const encodedPath = encodePathSegments(displayPath);
        const filename = displayPath.split("/").pop() ?? displayPath;
        const baseName = filename.replace(/\.[^.]+$/, "");
        const altText =
            ref.altText && ref.altText !== baseName ? ref.altText : baseName;
        return { text: `![${altText}](${encodedPath})`, skipped: false };
    }

    /** 计算从 fromDir 到 toPath 的相对路径 */
    computeRelativePath(fromDir: string, toPath: string): string {
        const fromParts = fromDir.split("/").filter(Boolean);
        const toParts = toPath.split("/").filter(Boolean);

        // Find common prefix length
        let commonLen = 0;
        while (
            commonLen < fromParts.length &&
            commonLen < toParts.length &&
            fromParts[commonLen] === toParts[commonLen]
        ) {
            commonLen++;
        }

        // Go up from fromDir to the common ancestor
        const upCount = fromParts.length - commonLen;
        const ups: string[] = Array.from({ length: upCount }, () => "..");
        // Then go down to the target
        const downs = toParts.slice(commonLen);

        const result = [...ups, ...downs].join("/");
        return result || toPath;
    }

    /** 使用来源笔记语义解析图片；同名歧义时不猜测。 */
    private resolveImagePath(
        path: string,
        noteFile: TFile | undefined,
        lookup: ReturnType<typeof createLocalFileLookup>,
    ): string | null {
        if (noteFile) {
            const resolution = resolveLocalFileReference(
                this.app,
                noteFile,
                path,
                "wiki",
                lookup,
            );
            return resolution.status === "resolved"
                ? resolution.file.path
                : null;
        }
        const exact = lookup.byPath.get(path);
        if (exact) return exact.path;
        const filename = path.split("/").pop() ?? path;
        const sameName = lookup.byName.get(filename) ?? [];
        return sameName.length === 1 ? sameName[0]!.path : null;
    }

    /** 转换整个文本中的所有引用，并返回实际转换与安全跳过数量。 */
    convertAllReferences(
        text: string,
        targetFormat: ReferenceFormat,
        noteFile?: TFile,
    ): ReferenceConversionResult {
        const refs = this.parseReferences(text);
        const lookup = createLocalFileLookup(this.app.vault.getFiles());
        let content = text;
        let converted = 0;
        let skipped = 0;

        for (let i = refs.length - 1; i >= 0; i--) {
            const ref = refs[i]!;
            const result = this.convertReferenceWithLookup(
                ref,
                targetFormat,
                noteFile,
                lookup,
            );
            if (result.skipped) skipped++;
            if (result.text === ref.fullMatch) continue;
            content =
                content.substring(0, ref.col) +
                result.text +
                content.substring(ref.col + ref.fullMatch.length);
            converted++;
        }

        return { content, converted, skipped };
    }

    /** 统计文件中的引用数量 */
    countReferences(text: string): { markdown: number; wiki: number } {
        MD_IMAGE_REGEX.lastIndex = 0;
        WIKI_IMAGE_REGEX.lastIndex = 0;
        return {
            markdown: (
                text.match(new RegExp(MD_IMAGE_REGEX.source, "gi")) ?? []
            ).length,
            wiki: (text.match(new RegExp(WIKI_IMAGE_REGEX.source, "gi")) ?? [])
                .length,
        };
    }
}
