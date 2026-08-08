import type { ImageReference } from '../types';

/** Finds only the exact local reference inserted by one managed paste item. */
export function findExactManagedPasteReference(
    references: readonly ImageReference[],
    localReference: string,
    resolvesToSavedFile: (reference: ImageReference) => boolean
): ImageReference | null {
    const matches = references.filter((reference) =>
        reference.fullMatch === localReference && resolvesToSavedFile(reference)
    );
    return matches.length === 1 ? matches[0]! : null;
}
