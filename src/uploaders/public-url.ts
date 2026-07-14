/** Encode a logical object key for use in an HTTP URL while preserving path separators. */
export function encodePublicPath(path: string): string {
    return path
        .split('/')
        .map((segment) => encodeURIComponent(segment).replace(/[!'()*]/g, (character) =>
            `%${character.charCodeAt(0).toString(16).toUpperCase()}`
        ))
        .join('/');
}

/** Normalize a user-provided public access URL base without changing its path. */
export function normalizePublicUrlBase(base: string): string {
    const trimmed = base.trim();
    if (!trimmed) return '';

    const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    return withProtocol.replace(/\/+$/, '');
}

/** Join a public access URL base and an already encoded object path. */
export function joinPublicUrl(base: string, encodedPath: string): string {
    const normalizedBase = normalizePublicUrlBase(base);
    if (!normalizedBase) return encodedPath;
    return encodedPath ? `${normalizedBase}/${encodedPath.replace(/^\/+/, '')}` : normalizedBase;
}
