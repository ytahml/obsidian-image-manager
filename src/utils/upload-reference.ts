/** Return whether an image reference points outside the Vault. */
export function isRemoteImageReference(path: string): boolean {
    const normalized = path.trim();
    return /^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(normalized);
}
