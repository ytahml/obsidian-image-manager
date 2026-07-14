/** Return whether an image reference points outside the Vault. */
export function isRemoteImageReference(path: string): boolean {
    const normalized = path.trim();
    return /^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(normalized);
}

/** Match only local references that resolve to the uploaded image. */
export function shouldReplaceLocalImageReference(
    referencePath: string,
    imageName: string,
    imagePath: string
): boolean {
    if (isRemoteImageReference(referencePath)) return false;

    const referenceName = referencePath.split('/').pop() ?? referencePath;
    return referenceName === imageName || referencePath === imagePath;
}
