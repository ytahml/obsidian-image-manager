import { describe, expect, it } from 'vitest';

import { renderCustomReference } from '../src/utils/reference-template';

describe('renderCustomReference', () => {
    const vars = { url: 'https://example.com/a.png' };

    it('replaces the {url} variable', () => {
        expect(renderCustomReference('<img src="{url}" />', vars)).toBe(
            '<img src="https://example.com/a.png" />'
        );
    });

    it('returns the template unchanged when it has no {url}', () => {
        expect(renderCustomReference('plain text without any placeholder', vars)).toBe(
            'plain text without any placeholder'
        );
    });

    it('returns an empty string for an empty template', () => {
        expect(renderCustomReference('', vars)).toBe('');
    });

    it('replaces every occurrence of a repeated {url}', () => {
        expect(renderCustomReference('{url} and {url}', vars)).toBe(
            'https://example.com/a.png and https://example.com/a.png'
        );
    });

    it('leaves unsupported placeholders untouched', () => {
        expect(renderCustomReference('<img src="{url}" alt="{alt}" />', vars)).toBe(
            '<img src="https://example.com/a.png" alt="{alt}" />'
        );
    });
});
