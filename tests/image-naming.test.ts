import { describe, expect, it } from 'vitest';

import { generateImageFileName, sanitizeImageFileName } from '../src/utils/image-naming';

const now = new Date(2026, 6, 14, 9, 8, 7, 123);

describe('image naming templates', () => {
    it('resolves the current note name with other variables', () => {
        expect(generateImageFileName('{noteName}-{date}-{counter}', 'png', '文章标题', now, 3)).toBe(
            '文章标题-2026-07-14-3.png'
        );
    });

    it('replaces repeated note name variables', () => {
        expect(generateImageFileName('{noteName}-{noteName}', 'jpg', 'Nested note', now, 0)).toBe(
            'Nested-note-Nested-note.jpg'
        );
    });

    it('keeps existing time variables and extension handling', () => {
        expect(generateImageFileName('{year}{month}{day}-{time}-{timestamp}', 'webp', '', now, 0)).toBe(
            `20260714-090807-${now.getTime()}.webp`
        );
    });

    it('falls back to image when the resolved note name is empty', () => {
        expect(generateImageFileName('{noteName}', 'png', '', now, 0)).toBe('image.png');
    });

    it('preserves the existing sanitization behavior', () => {
        expect(sanitizeImageFileName('  bad:/ name.PNG', 'png')).toBe('bad-name.png');
    });
});
