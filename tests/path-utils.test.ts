import { describe, expect, it, vi } from 'vitest';

vi.mock('obsidian', () => ({
    normalizePath: (path: string) => path.replace(/^\/+|\/+$/g, '').replace(/\/+/g, '/'),
}));

import {
    encodePathSegments,
    formatFileSize,
    getFileNameWithoutExt,
    joinPath,
} from '../src/utils/path-utils';

describe('path utilities', () => {
    it.each([
        ['folder/photo.png', 'photo'],
        ['archive.tar.gz', 'archive.tar'],
        ['README', 'README'],
        ['.gitignore', '.gitignore'],
    ])('extracts the filename stem from %s', (path, expected) => {
        expect(getFileNameWithoutExt(path)).toBe(expected);
    });

    it('joins paths without duplicate separators', () => {
        expect(joinPath('/notes/', '/assets', 'photo.png')).toBe('notes/assets/photo.png');
    });

    it.each([
        [0, '0 B'],
        [1023, '1023 B'],
        [1024, '1.0 KB'],
        [1536, '1.5 KB'],
        [1024 * 1024, '1.0 MB'],
    ])('formats %i bytes', (bytes, expected) => {
        expect(formatFileSize(bytes)).toBe(expected);
    });

    it('encodes Markdown-conflicting characters without over-encoding URLs', () => {
        expect(encodePathSegments('my folder/a+b & c(1)[2].png')).toBe(
            'my%20folder/a+b%20&%20c%281%29%5B2%5D.png'
        );
    });
});
