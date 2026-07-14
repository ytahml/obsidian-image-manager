import { DEFAULT_UPLOAD_PATH_TEMPLATE, type UploadContext } from '../types';

export function selectUploadPathTemplate(
    providerTemplate: string,
    globalTemplate: string
): string {
    return providerTemplate || globalTemplate || DEFAULT_UPLOAD_PATH_TEMPLATE;
}

function getSourceDir(sourcePath?: string): string {
    if (!sourcePath) return '';

    const parts = sourcePath
        .replace(/\\/g, '/')
        .split('/')
        .filter(Boolean);
    parts.pop();
    return parts.join('/');
}

export async function resolveUploadPath(
    template: string,
    filename: string,
    data?: ArrayBuffer,
    context: UploadContext = {},
    now = new Date()
): Promise<string> {
    let hash = '';
    if (data) {
        const hashBuffer = await crypto.subtle.digest('SHA-256', data);
        hash = Array.from(new Uint8Array(hashBuffer))
            .map((byte) => byte.toString(16).padStart(2, '0'))
            .join('')
            .substring(0, 16);
    }

    const variables: Record<string, string> = {
        year: now.getFullYear().toString(),
        month: String(now.getMonth() + 1).padStart(2, '0'),
        day: String(now.getDate()).padStart(2, '0'),
        filename: filename.replace(/\.[^.]+$/, ''),
        ext: filename.split('.').pop() ?? '',
        timestamp: Math.floor(now.getTime() / 1000).toString(),
        hash: hash || Math.random().toString(36).substring(2, 10),
        sourceDir: getSourceDir(context.sourcePath),
    };

    let resolvedPath = template;
    for (const [key, value] of Object.entries(variables)) {
        resolvedPath = resolvedPath.replace(new RegExp(`\\{${key}\\}`, 'g'), value);
    }

    if (template.includes('{sourceDir}')) {
        resolvedPath = resolvedPath.replace(/\/{2,}/g, '/').replace(/^\/+|\/+$/g, '');
    }

    return resolvedPath;
}
