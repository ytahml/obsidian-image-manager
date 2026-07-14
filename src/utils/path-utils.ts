import { normalizePath } from 'obsidian';

/** 从路径中提取文件名（不含扩展名） */
export function getFileNameWithoutExt(path: string): string {
    const name = path.split('/').pop() ?? path;
    const dotIndex = name.lastIndexOf('.');
    return dotIndex > 0 ? name.substring(0, dotIndex) : name;
}

/** 拼接并规范化路径 */
export function joinPath(...parts: string[]): string {
    return normalizePath(parts.join('/').replace(/\/+/g, '/'));
}

/** 格式化文件大小 */
export function formatFileSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const MARKDOWN_PATH_SAFE_ASCII = /^[A-Za-z0-9._~!$&'*+,;=:@-]$/;

function encodeMarkdownPathSegment(segment: string): string {
    return Array.from(segment, (character) => {
        const codePoint = character.codePointAt(0)!;
        if (codePoint > 0x7F || MARKDOWN_PATH_SAFE_ASCII.test(character)) return character;
        return `%${codePoint.toString(16).toUpperCase().padStart(2, '0')}`;
    }).join('');
}

/** 编码 Markdown URL path segment 中的敏感 ASCII，保留 Unicode 与 RFC 3986 pchar 安全集 */
export function encodePathSegments(path: string): string {
    return path.split('/').map(encodeMarkdownPathSegment).join('/');
}

/** 逐段还原 Markdown 本地路径；无效百分号编码保持原样，避免整条路径解码失败 */
export function decodePathSegments(path: string): string {
    return path
        .split('/')
        .map((segment) => {
            try {
                return decodeURIComponent(segment);
            } catch {
                return segment;
            }
        })
        .join('/');
}

/** 获取当前日期的模板变量 */
export function getDateTemplateVars(): Record<string, string> {
    const now = new Date();
    return {
        year: now.getFullYear().toString(),
        month: String(now.getMonth() + 1).padStart(2, '0'),
        day: String(now.getDate()).padStart(2, '0'),
        timestamp: Math.floor(now.getTime() / 1000).toString(),
    };
}
