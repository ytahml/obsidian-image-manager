import { normalizePath } from 'obsidian';

/** 从路径中提取文件名（不含扩展名） */
export function getFileNameWithoutExt(path: string): string {
    const name = path.split('/').pop() ?? path;
    const dotIndex = name.lastIndexOf('.');
    return dotIndex > 0 ? name.substring(0, dotIndex) : name;
}

/** 从路径中提取文件扩展名 */
export function getExtension(path: string): string {
    const name = path.split('/').pop() ?? path;
    const dotIndex = name.lastIndexOf('.');
    return dotIndex > 0 ? name.substring(dotIndex + 1).toLowerCase() : '';
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

/** 生成上传路径（替换模板变量） */
export function resolveUploadPath(template: string, vars: Record<string, string>): string {
    let result = template;
    for (const [key, value] of Object.entries(vars)) {
        result = result.replace(new RegExp(`\\{${key}\\}`, 'g'), value);
    }
    return normalizePath(result);
}

/** URL 编码路径的每一段，仅编码 Markdown 语法冲突字符（空格、括号等），保留 + 等正常字符 */
export function encodePathSegments(path: string): string {
    return path
        .split('/')
        .map((seg) =>
            seg
                .replace(/ /g, '%20')
                .replace(/\(/g, '%28')
                .replace(/\)/g, '%29')
                .replace(/\[/g, '%5B')
                .replace(/\]/g, '%5D')
        )
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
