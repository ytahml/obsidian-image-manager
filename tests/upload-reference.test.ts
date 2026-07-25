import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
    isRemoteImageReference,
    shouldReplaceLocalImageReference,
} from '../src/utils/upload-reference';

describe('uploaded image reference replacement', () => {
    it.each([
        'https://cdn.example.com/assets/photo.png',
        'HTTP://cdn.example.com/photo.png',
        '//cdn.example.com/photo.png',
        'data:image/png;base64,abc',
        'blob:https://example.com/id',
    ])('recognizes remote image reference %s', (path) => {
        expect(isRemoteImageReference(path)).toBe(true);
    });

    it.each([
        'assets/photo.png',
        '../assets/photo.png',
        'photo.png',
    ])('recognizes local image reference %s', (path) => {
        expect(isRemoteImageReference(path)).toBe(false);
    });

    it('matches local references by filename or Vault path', () => {
        expect(shouldReplaceLocalImageReference('assets/photo.png', 'photo.png', 'notes/assets/photo.png')).toBe(true);
        expect(shouldReplaceLocalImageReference('notes/assets/photo.png', 'other.png', 'notes/assets/photo.png')).toBe(true);
    });

    it('does not replace remote references even when the filename matches', () => {
        expect(shouldReplaceLocalImageReference(
            'https://cdn.example.com/assets/photo.png',
            'photo.png',
            'notes/assets/photo.png'
        )).toBe(false);
    });

    it('does not replace unrelated local references', () => {
        expect(shouldReplaceLocalImageReference(
            'assets/other.png',
            'photo.png',
            'notes/assets/photo.png'
        )).toBe(false);
    });

    it('skips the current note after the editor has already updated it', async () => {
        const mainPath = fileURLToPath(new URL('../src/main.ts', import.meta.url));
        const source = await readFile(mainPath, 'utf8');

        expect(source).toContain(
            'currentFile ?? undefined,\n                    templateVars'
        );
    });
});
