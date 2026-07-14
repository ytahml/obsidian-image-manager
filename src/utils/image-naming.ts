export function generateImageFileName(
    template: string,
    ext: string,
    noteName: string,
    now: Date,
    counter: number
): string {
    const vars: Record<string, string> = {
        noteName,
        date: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`,
        time: `${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}`,
        timestamp: String(now.getTime()),
        year: String(now.getFullYear()),
        month: String(now.getMonth() + 1).padStart(2, '0'),
        day: String(now.getDate()).padStart(2, '0'),
        counter: String(counter),
    };

    let resolved = template || 'image-{timestamp}';
    for (const [key, value] of Object.entries(vars)) {
        resolved = resolved.replace(new RegExp(`\\{${key}\\}`, 'g'), value);
    }

    return sanitizeImageFileName(resolved, ext);
}

export function sanitizeImageFileName(name: string, ext: string): string {
    const extPattern = new RegExp(`\\.${ext}$`, 'i');
    let base = name.replace(extPattern, '');

    base = base
        .replace(/\s+/g, '-')
        .replace(/[/\\:*?"<>|]/g, '')
        .replace(/-{2,}/g, '-')
        .replace(/^-+|-+$/g, '');

    if (!base) base = 'image';

    return `${base}.${ext}`;
}
