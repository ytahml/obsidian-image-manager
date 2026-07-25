import { describe, expect, it, vi } from 'vitest';

vi.mock('obsidian', () => ({
    normalizePath: (path: string) => path.replace(/^\/+|\/+$/g, '').replace(/\/+/g, '/'),
}));

import {
    encodePathSegments,
    decodePathSegments,
    formatFileSize,
    getFileNameWithoutExt,
    joinPath,
} from '../src/utils/path-utils';
import { makePublicUrlReadable } from '../src/utils/public-url';

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
        expect(encodePathSegments('my folder/a+b & c(1)[2]#50%.png')).toBe(
            'my%20folder/a+b%20&%20c%281%29%5B2%5D%2350%25.png'
        );
    });

    it('encodes all unsafe ASCII characters that can change Markdown or URL parsing', () => {
        expect(encodePathSegments('space #%?()[]<>"\\^`{|}\t.png')).toBe(
            'space%20%23%25%3F%28%29%5B%5D%3C%3E%22%5C%5E%60%7B%7C%7D%09.png'
        );
    });

    it('preserves path separators, Unicode, and RFC 3986 path-safe ASCII', () => {
        expect(encodePathSegments("目录/图片-._~!$&'*+,;=:@.png")).toBe(
            "目录/图片-._~!$&'*+,;=:@.png"
        );
    });

    it('decodes local Markdown paths segment by segment without failing on invalid escapes', () => {
        expect(decodePathSegments('目录/my%20image%2520%23.png/bad%name')).toBe(
            '目录/my image%20#.png/bad%name'
        );
    });
});

describe('public URL Markdown formatting', () => {
    it('decodes Unicode path bytes while preserving URL-sensitive ASCII encoding', () => {
        expect(makePublicUrlReadable(
            'https://cdn.example.com/images/%E5%9B%BE%E7%89%87%20%231%3F%25%28%29.png'
        )).toBe('https://cdn.example.com/images/图片%20%231%3F%25%28%29.png');
    });

    it('does not modify query parameters or fragments', () => {
        expect(makePublicUrlReadable(
            'https://cdn.example.com/%E5%9B%BE%E7%89%87.png?name=%E6%B5%8B%E8%AF%95#%E7%89%87%E6%AE%B5'
        )).toBe(
            'https://cdn.example.com/图片.png?name=%E6%B5%8B%E8%AF%95#%E7%89%87%E6%AE%B5'
        );
    });

    it('preserves existing Unicode, repeated encodings, and invalid sequences', () => {
        expect(makePublicUrlReadable(
            'https://cdn.example.com/图片/%E5%9B%BE%E7%89%87/%E5%ZZ.png'
        )).toBe('https://cdn.example.com/图片/图片/%E5%ZZ.png');
    });
});
