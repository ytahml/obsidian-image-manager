import { describe, expect, it, vi } from 'vitest';

import {
    referenceTemplateRequiresDimensions,
    renderCustomReference,
    resolveReferenceTemplateFileVars,
    validateReferenceTemplate,
} from '../src/utils/reference-template';

describe('renderCustomReference', () => {
    const vars = {
        fileUrl: 'https://example.com/a.png',
        fileAlt: 'Cover image',
        fileName: 'a.png',
        fileBaseName: 'a',
        fileExt: 'png',
        fileWidth: 1920,
        fileHeight: 1080,
    };

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

    it('returns null for an empty, whitespace-only, or missing-URL template', () => {
        expect(renderCustomReference('', vars)).toBeNull();
        expect(renderCustomReference('   ', vars)).toBeNull();
        expect(renderCustomReference('plain text without any placeholder', vars)).toBeNull();
    });

    it('replaces every occurrence of a repeated {fileUrl}', () => {
        expect(renderCustomReference('{fileUrl} and {fileUrl}', vars)).toBe(
            'https://example.com/a.png and https://example.com/a.png'
        );
    });

    it('renders the supported file metadata and dimension variables', () => {
        expect(renderCustomReference(
            '<img src="{fileUrl}" alt="{fileAlt}" width="{fileWidth}" height="{fileHeight}" data-name="{fileName}" data-base="{fileBaseName}" data-ext="{fileExt}" />',
            vars
        )).toBe(
            '<img src="https://example.com/a.png" alt="Cover image" width="1920" height="1080" data-name="a.png" data-base="a" data-ext="png" />'
        );
    });

    it('rejects unknown placeholders while preserving non-placeholder braces', () => {
        expect(renderCustomReference('<img src="{fileUrl}" data-x="{unknown}" />', vars)).toBeNull();
        expect(renderCustomReference('<style>img { width: 100%; }</style>{fileUrl}', vars)).toBe(
            '<style>img { width: 100%; }</style>https://example.com/a.png'
        );
    });

    it('returns null when a requested dimension is unavailable or invalid', () => {
        const withoutDimensions = { ...vars, fileWidth: undefined, fileHeight: undefined };
        expect(renderCustomReference('<img src="{fileUrl}" width="{fileWidth}" />', withoutDimensions)).toBeNull();
        expect(renderCustomReference('<img src="{fileUrl}" height="{fileHeight}" />', {
            ...vars,
            fileHeight: 0,
        })).toBeNull();
        expect(renderCustomReference('<img src="{fileUrl}" alt="{fileAlt}" />', withoutDimensions)).toBe(
            '<img src="https://example.com/a.png" alt="Cover image" />'
        );
    });

    it('does not interpret replacement sequences in URLs or alt text', () => {
        const specialVars = {
            ...vars,
            fileUrl: 'https://example.com/a$&b$`c$\'d.png',
            fileAlt: 'Cover $& $` $\'',
        };
        expect(renderCustomReference('<img src="{fileUrl}" alt="{fileAlt}" />', specialVars)).toBe(
            '<img src="https://example.com/a$&b$`c$\'d.png" alt="Cover $& $` $\'" />'
        );
    });
});

describe('validateReferenceTemplate', () => {
    it('distinguishes disabled, valid, missing-URL, and unknown-variable templates', () => {
        expect(validateReferenceTemplate('')).toEqual({ status: 'disabled' });
        expect(validateReferenceTemplate('{fileAlt}')).toEqual({
            status: 'invalid',
            reason: 'missing-file-url',
            unknownVariables: [],
        });
        expect(validateReferenceTemplate('{fileUrl} {customValue}')).toEqual({
            status: 'invalid',
            reason: 'unknown-variable',
            unknownVariables: ['customValue'],
        });
        expect(validateReferenceTemplate('{fileUrl} {fileWidth}')).toMatchObject({
            status: 'valid',
            requiresDimensions: true,
        });
    });

    it('only requests dimension decoding for structurally valid dimension templates', () => {
        expect(referenceTemplateRequiresDimensions('{fileUrl}')).toBe(false);
        expect(referenceTemplateRequiresDimensions('{fileUrl} {fileHeight}')).toBe(true);
        expect(referenceTemplateRequiresDimensions('{fileHeight}')).toBe(false);
        expect(referenceTemplateRequiresDimensions('{fileUrl} {unknown} {fileWidth}')).toBe(false);
    });
});

describe('resolveReferenceTemplateFileVars', () => {
    it('normalizes file metadata without decoding dimensions when they are unused', async () => {
        const readDimensions = vi.fn().mockResolvedValue({ width: 100, height: 50 });
        await expect(resolveReferenceTemplateFileVars(
            '{fileUrl} {fileName}',
            { name: 'Cover.PNG', extension: 'PNG' },
            readDimensions
        )).resolves.toEqual({
            fileName: 'Cover.PNG',
            fileBaseName: 'Cover',
            fileExt: 'png',
        });
        expect(readDimensions).not.toHaveBeenCalled();
    });

    it('decodes dimensions once when requested and contains decoder failures', async () => {
        const readDimensions = vi.fn().mockResolvedValue({ width: 640, height: 480 });
        await expect(resolveReferenceTemplateFileVars(
            '<img src="{fileUrl}" width="{fileWidth}" height="{fileHeight}">',
            { name: 'cover.webp', extension: 'webp' },
            readDimensions
        )).resolves.toMatchObject({ fileWidth: 640, fileHeight: 480 });
        expect(readDimensions).toHaveBeenCalledTimes(1);

        const error = new Error('Unsupported image');
        const onError = vi.fn();
        await expect(resolveReferenceTemplateFileVars(
            '{fileUrl} {fileWidth}',
            { name: 'cover.tiff', extension: 'tiff' },
            vi.fn().mockRejectedValue(error),
            onError
        )).resolves.toEqual({
            fileName: 'cover.tiff',
            fileBaseName: 'cover',
            fileExt: 'tiff',
        });
        expect(onError).toHaveBeenCalledWith(error);
    });
});
