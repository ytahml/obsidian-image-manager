import { describe, expect, it } from 'vitest';
import type { ImageReference } from '../src/types';
import { getDelegatedReferenceId } from '../src/lifecycle/reference-identity';

function reference(col: number): ImageReference {
    return {
        fullMatch: '![](attachments/image.png)',
        altText: '',
        path: 'attachments/image.png',
        format: 'markdown',
        line: 0,
        col,
    };
}

describe('delegated reference identity', () => {
    it('does not change when an earlier transaction shifts its character offset', () => {
        expect(getDelegatedReferenceId(reference(12))).toBe(getDelegatedReferenceId(reference(148)));
    });
});
