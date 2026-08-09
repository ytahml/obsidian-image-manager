import { describe, expect, it, vi } from 'vitest';

vi.mock('obsidian', () => ({
    MarkdownView: class MarkdownView {},
    TFile: class TFile {},
    normalizePath: (path: string) => path.replace(/^\/+|\/+$/g, ''),
}));

import { TFile, type App } from 'obsidian';
import type { ImageHostingConfig, ImageReference } from '../src/types';
import type { RefConverter } from '../src/utils/ref-converter';
import { ExplicitUploadWorkflow } from '../src/uploaders/explicit-upload-workflow';
import type { UploadService } from '../src/uploaders/upload-service';
import type { UploadReferenceManager } from '../src/uploaders/upload-reference-manager';

function file(path: string): TFile {
    const result = new TFile();
    result.path = path;
    result.name = path.split('/').pop() ?? path;
    result.extension = path.split('.').pop() ?? '';
    result.parent = null;
    return result;
}

function hosting(): ImageHostingConfig {
    return {
        id: 'hosting',
        name: 'Hosting',
        type: 'custom',
        enabled: true,
        config: { uploadUrl: '', method: 'POST', headers: {}, fileFieldName: 'file', jsonPath: '', extraBody: {} },
        uploadPath: '',
        urlPrefix: '',
    };
}

function reference(fullMatch: string, path: string, altText: string, col: number): ImageReference {
    return { fullMatch, path, altText, col, line: 0, format: 'markdown' };
}

describe('ExplicitUploadWorkflow', () => {
    it('returns a prepared reference and optional Vault replacement for one image', async () => {
        const image = file('assets/photo.png');
        const uploadFile = vi.fn(async () => ({
            success: true,
            url: 'https://cdn.example/photo.png',
            hostingId: 'hosting',
            hostingType: 'custom' as const,
            originalPath: image.path,
            attempts: 1,
        }));
        const prepared = { render: vi.fn(() => '![photo](https://cdn.example/photo.png)') };
        const replaceVaultReferences = vi.fn(async () => 3);
        const uploadReferences = {
            prepare: vi.fn(async () => prepared),
            replaceVaultReferences,
        } as unknown as UploadReferenceManager;
        const workflow = new ExplicitUploadWorkflow(
            {} as App,
            { uploadFile } as unknown as UploadService,
            {} as RefConverter,
            uploadReferences
        );

        await expect(workflow.uploadImage(image, hosting(), true)).resolves.toMatchObject({
            reference: '![photo](https://cdn.example/photo.png)',
            replacedReferences: 3,
        });
        expect(replaceVaultReferences).toHaveBeenCalledTimes(1);
    });

    it('uploads a repeated note image once and replaces every occurrence before other notes', async () => {
        const note = file('notes/current.md');
        const image = file('assets/photo.png');
        const first = '![first](../assets/photo.png)';
        const second = '![second](../assets/photo.png)';
        const content = `${first}\ntext\n${second}`;
        const refs = [
            reference(first, '../assets/photo.png', 'first', 0),
            reference(second, '../assets/photo.png', 'second', content.indexOf(second)),
        ];
        let saved = content;
        const process = vi.fn(async (_file: TFile, update: (value: string) => string) => {
            saved = update(saved);
        });
        const app = {
            workspace: { getActiveViewOfType: vi.fn(() => null) },
            metadataCache: { getFirstLinkpathDest: vi.fn(() => image) },
            vault: {
                read: vi.fn(async () => content),
                getAbstractFileByPath: vi.fn(),
                getFiles: vi.fn(() => [image]),
                process,
            },
        } as unknown as App;
        const uploadFile = vi.fn(async () => ({
            success: true,
            url: 'https://cdn.example/photo.png',
            hostingId: 'hosting',
            hostingType: 'custom' as const,
            originalPath: image.path,
            attempts: 1,
        }));
        const prepared = {
            render: vi.fn((_url: string, alt?: string) => `![${alt}](https://cdn.example/photo.png)`),
        };
        const replaceVaultReferences = vi.fn(async () => 1);
        const workflow = new ExplicitUploadWorkflow(
            app,
            { uploadFile } as unknown as UploadService,
            { parseReferences: vi.fn(() => refs) } as unknown as RefConverter,
            {
                prepare: vi.fn(async () => prepared),
                replaceVaultReferences,
            } as unknown as UploadReferenceManager
        );

        await expect(workflow.uploadNote(note, hosting())).resolves.toEqual({
            totalReferences: 2,
            successfulReferences: 2,
            uploadedImages: 1,
            failures: [],
        });
        expect(uploadFile).toHaveBeenCalledTimes(1);
        expect(saved).toBe(
            '![first](https://cdn.example/photo.png)\ntext\n![second](https://cdn.example/photo.png)'
        );
        expect(process).toHaveBeenCalledTimes(1);
        expect(replaceVaultReferences).toHaveBeenCalledWith(
            image,
            'https://cdn.example/photo.png',
            prepared,
            { skipFile: note }
        );
        expect(process.mock.invocationCallOrder[0]).toBeLessThan(
            replaceVaultReferences.mock.invocationCallOrder[0]!
        );
    });

    it('does not modify other notes when writing the selected note fails', async () => {
        const note = file('notes/current.md');
        const image = file('assets/photo.png');
        const match = '![photo](../assets/photo.png)';
        const app = {
            workspace: { getActiveViewOfType: vi.fn(() => null) },
            metadataCache: { getFirstLinkpathDest: vi.fn(() => image) },
            vault: {
                read: vi.fn(async () => match),
                getAbstractFileByPath: vi.fn(),
                getFiles: vi.fn(() => [image]),
                process: vi.fn(async () => { throw new Error('write failed'); }),
            },
        } as unknown as App;
        const replaceVaultReferences = vi.fn();
        const workflow = new ExplicitUploadWorkflow(
            app,
            {
                uploadFile: vi.fn(async () => ({
                    success: true,
                    url: 'https://cdn.example/photo.png',
                    hostingId: 'hosting',
                    hostingType: 'custom' as const,
                    originalPath: image.path,
                    attempts: 1,
                })),
            } as unknown as UploadService,
            {
                parseReferences: vi.fn(() => [reference(match, '../assets/photo.png', 'photo', 0)]),
            } as unknown as RefConverter,
            {
                prepare: vi.fn(async () => ({
                    render: () => '![photo](https://cdn.example/photo.png)',
                })),
                replaceVaultReferences,
            } as unknown as UploadReferenceManager
        );

        await expect(workflow.uploadNote(note, hosting())).rejects.toThrow('write failed');
        expect(replaceVaultReferences).not.toHaveBeenCalled();
    });
});
