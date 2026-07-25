import { describe, expect, it } from 'vitest';

import { renderCustomReference } from '../src/utils/reference-template';

describe('renderCustomReference', () => {
    const vars = { fileUrl: 'https://example.com/a.png', fileAlt: 'Cover image' };

    it('replaces the {fileUrl} variable', () => {
        expect(renderCustomReference('<img src="{fileUrl}" />', vars)).toBe(
            '<img src="https://example.com/a.png" />'
        );
    });

    it('replaces the {fileAlt} variable', () => {
        expect(renderCustomReference('<img src="{fileUrl}" alt="{fileAlt}" />', vars)).toBe(
            '<img src="https://example.com/a.png" alt="Cover image" />'
        );
    });

    it('returns null for an empty, whitespace-only, or invalid template', () => {
        expect(renderCustomReference('', vars)).toBeNull();
        expect(renderCustomReference('   ', vars)).toBeNull();
        expect(renderCustomReference('plain text without any placeholder', vars)).toBeNull();
    });

    it('replaces every occurrence of a repeated {fileUrl}', () => {
        expect(renderCustomReference('{fileUrl} and {fileUrl}', vars)).toBe(
            'https://example.com/a.png and https://example.com/a.png'
        );
    });

    it('keeps unknown placeholders unchanged', () => {
        expect(renderCustomReference('<img src="{fileUrl}" width="{fileWidth}" />', vars)).toBe(
            '<img src="https://example.com/a.png" width="{fileWidth}" />'
        );
    });

    it('does not interpret replacement sequences in URLs or alt text', () => {
        const specialVars = {
            fileUrl: 'https://example.com/a$&b$`c$\'d.png',
            fileAlt: 'Cover $& $` $\'',
        };
        expect(renderCustomReference('<img src="{fileUrl}" alt="{fileAlt}" />', specialVars)).toBe(
            '<img src="https://example.com/a$&b$`c$\'d.png" alt="Cover $& $` $\'" />'
        );
    });
});
