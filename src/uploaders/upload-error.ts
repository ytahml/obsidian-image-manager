/** Convert transport/provider failures into a concise message safe for notices. */
export function summarizeUploadError(error: string | undefined): string {
    if (!error?.trim()) return 'Unknown error';

    const status = error.match(/\bHTTP\s+(\d{3})\b/i)?.[1];
    const code = error.match(/<Code>\s*([^<\s]+)\s*<\/Code>/i)?.[1];
    if (status && code) return `HTTP ${status} (${code})`;
    if (status) return `HTTP ${status}`;

    return error.replace(/\s+/g, ' ').trim().slice(0, 160);
}
