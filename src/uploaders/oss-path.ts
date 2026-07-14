/** Encode each OSS object key segment while preserving path separators. */
export function encodeOSSKey(key: string): string {
    return key
        .split('/')
        .map((segment) => encodeURIComponent(segment).replace(/[!'()*]/g, (character) =>
            `%${character.charCodeAt(0).toString(16).toUpperCase()}`
        ))
        .join('/');
}
