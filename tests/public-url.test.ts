import { describe, expect, it } from 'vitest';
import { makePublicUrlReadable } from '../src/utils/public-url';

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
