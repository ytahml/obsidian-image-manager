import { describe, expect, it } from 'vitest';
import type { ImageReference } from '../src/types';
import { findExactManagedPasteReference } from '../src/lifecycle/managed-paste-reference';

function reference(fullMatch: string, path: string, col = 0): ImageReference {
    return { fullMatch, path, col, altText: '', format: fullMatch.startsWith('![[') ? 'wiki' : 'markdown', line: 0 };
}

describe('findExactManagedPasteReference', () => {
    it('finds the unique inserted Wiki reference independently of the current cursor', () => {
        const target = reference('![[pasted.png]]', 'pasted.png', 30);
        expect(findExactManagedPasteReference(
            [reference('![](other.png)', 'other.png'), target],
            target.fullMatch,
            (candidate) => candidate === target
        )).toBe(target);
    });

    it('fails closed for duplicate exact references or a reference resolving to another file', () => {
        const first = reference('![[same.png]]', 'same.png');
        const second = reference('![[same.png]]', 'same.png', 20);
        expect(findExactManagedPasteReference([first, second], first.fullMatch, () => true)).toBeNull();
        expect(findExactManagedPasteReference([first], first.fullMatch, () => false)).toBeNull();
    });
});
