import type { ImageReference } from '../types';

/**
 * Stable identity for a delegated transaction reference.
 *
 * Character offsets are intentionally excluded: another transaction may replace
 * text before this reference without changing the reference itself.
 */
export function getDelegatedReferenceId(reference: ImageReference): string {
    return reference.fullMatch;
}
