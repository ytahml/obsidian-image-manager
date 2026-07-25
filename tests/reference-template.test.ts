import { describe, expect, it } from 'vitest';

import { renderCustomReference } from '../src/utils/reference-template';

describe('renderCustomReference', () => {
    const vars = { url: 'https://example.com/a.png', alt: 'Cover image' };

    it('replaces the {url} variable', () => {
        expect(renderCustomReference('<img src="{url}" />', vars)).toBe(
            '<img src="https://example.com/a.png" />'
        );
    });

    it('replaces the {alt} variable', () => {
        expect(renderCustomReference('<img src="{url}" alt="{alt}" />', vars)).toBe(
            '<img src="https://example.com/a.png" alt="Cover image" />'
        );
    });

    it('returns null for an empty, whitespace-only, or invalid template', () => {
        expect(renderCustomReference('', vars)).toBeNull();
        expect(renderCustomReference('   ', vars)).toBeNull();
        expect(renderCustomReference('plain text without any placeholder', vars)).toBeNull();
    });

    it('replaces every occurrence of a repeated {url}', () => {
        expect(renderCustomReference('{url} and {url}', vars)).toBe(
            'https://example.com/a.png and https://example.com/a.png'
        );
    });

    it('keeps unknown placeholders unchanged', () => {
        expect(renderCustomReference('<img src="{url}" width="{width}" />', vars)).toBe(
            '<img src="https://example.com/a.png" width="{width}" />'
        );
    });

    it('does not interpret replacement sequences in URLs or alt text', () => {
        const specialVars = {
            url: 'https://example.com/a$&b$`c$\'d.png',
            alt: 'Cover $& $` $\'',
        };
        expect(renderCustomReference('<img src="{url}" alt="{alt}" />', specialVars)).toBe(
            '<img src="https://example.com/a$&b$`c$\'d.png" alt="Cover $& $` $\'" />'
        );
    });
});
