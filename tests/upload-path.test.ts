import { describe, expect, it } from 'vitest';
import { resolveUploadPath, selectUploadPathTemplate } from '../src/uploaders/upload-path';
import { DEFAULT_UPLOAD_PATH_TEMPLATE } from '../src/types';

describe('upload path templates', () => {
    it('prefers a provider template, then the global template, then the default', () => {
        expect(selectUploadPathTemplate('provider/{filename}', 'global/{filename}')).toBe(
            'provider/{filename}'
        );
        expect(selectUploadPathTemplate('', 'global/{filename}')).toBe('global/{filename}');
        expect(selectUploadPathTemplate('', '')).toBe(DEFAULT_UPLOAD_PATH_TEMPLATE);
    });

    it('resolves a nested Vault-relative source directory', async () => {
        const result = await resolveUploadPath(
            'images/{sourceDir}/{filename}.{ext}',
            '图 1.png',
            new ArrayBuffer(0),
            { sourcePath: 'Projects/A/attachments/图 1.png' },
            new Date(2026, 6, 14, 12, 0, 0)
        );

        expect(result).toBe('images/Projects/A/attachments/图 1.png');
    });

    it('preserves the existing date, hash, filename, and extension variables', async () => {
        const now = new Date(2026, 6, 14, 12, 0, 0);
        const result = await resolveUploadPath(
            '{year}/{month}/{day}/{timestamp}/{hash}/{filename}.{ext}',
            'photo.png',
            new ArrayBuffer(0),
            {},
            now
        );

        expect(result).toBe(
            `2026/07/14/${Math.floor(now.getTime() / 1000)}/e3b0c44298fc1c14/photo.png`
        );
    });

    it('removes empty source-directory separators for a root file', async () => {
        const result = await resolveUploadPath(
            '/images/{sourceDir}/{filename}.{ext}/',
            'photo.png',
            new ArrayBuffer(0),
            { sourcePath: 'photo.png' }
        );

        expect(result).toBe('images/photo.png');
    });

    it('preserves legacy path formatting when sourceDir is not used', async () => {
        const result = await resolveUploadPath(
            '/legacy//{filename}.{ext}',
            'photo.png',
            new ArrayBuffer(0)
        );

        expect(result).toBe('/legacy//photo.png');
    });
});
