import { describe, expect, it, vi } from 'vitest';

vi.mock('obsidian', () => ({
    Notice: class Notice {
        hide(): void {}
    },
    TFile: class TFile {},
}));
vi.mock('../src/modals/image-name-prompt', () => ({
    ImageNamePromptModal: class ImageNamePromptModal {},
}));
vi.mock('../src/utils/local-orphan-management', () => ({
    scanLocalOrphans: vi.fn(),
}));
vi.mock('../src/utils/empty-folder-cleanup', () => ({
    removeEmptyDirectParent: vi.fn(),
}));

import { TFile, type App, type Editor } from 'obsidian';
import { ManagedPastePipeline } from '../src/lifecycle/managed-paste-pipeline';
import { DEFAULT_SETTINGS, type ImageManagerSettings, type ImageReference } from '../src/types';
import type { RefConverter } from '../src/utils/ref-converter';
import type { UploadService } from '../src/uploaders/upload-service';

function file(path: string, parentPath = ''): TFile {
    const target = new TFile();
    target.path = path;
    target.name = path.split('/').pop()!;
    target.extension = target.name.split('.').pop()!;
    target.parent = { path: parentPath } as TFile['parent'];
    return target;
}

function parseReferences(content: string): ImageReference[] {
    const match = /!\[([^\]]*)\]\(([^)]+)\)/.exec(content);
    if (!match) return [];
    return [{
        fullMatch: match[0],
        altText: match[1]!,
        path: match[2]!,
        format: 'markdown',
        line: 0,
        col: match.index,
    }];
}

function harness(overrides: Partial<ImageManagerSettings> = {}) {
    const settings: ImageManagerSettings = {
        ...DEFAULT_SETTINGS,
        imageNamingTemplate: 'managed image',
        imagePathTemplate: 'attachments',
        compressManagedPasteLocal: false,
        managedAutoUploadOnPaste: false,
        ...overrides,
    };
    const files = new Map<string, TFile>();
    const createFolder = vi.fn(async (path: string) => {
        const folderEntry = new TFile();
        folderEntry.path = path;
        files.set(path, folderEntry);
    });
    const createBinary = vi.fn(async (path: string) => {
        const created = file(path, path.split('/').slice(0, -1).join('/'));
        files.set(path, created);
        return created;
    });
    const app = {
        vault: {
            adapter: { exists: async () => false },
            getAbstractFileByPath: (path: string) => files.get(path) ?? null,
            createFolder,
            createBinary,
        },
        metadataCache: {
            getFirstLinkpathDest: (path: string) =>
                Array.from(files.values()).find((candidate) => candidate.name === path || candidate.path === path) ?? null,
        },
        fileManager: { trashFile: vi.fn() },
    } as unknown as App;
    let content = '';
    const replaceSelection = vi.fn((replacement: string) => { content += replacement; });
    const replaceRange = vi.fn((replacement: string, start: { ch: number }, end: { ch: number }) => {
        content = content.substring(0, start.ch) + replacement + content.substring(end.ch);
    });
    const editor = {
        replaceSelection,
        replaceRange,
        getValue: () => content,
    } as unknown as Editor;
    const uploadFile = vi.fn();
    const uploadData = vi.fn();
    const replaceReferenceInNotes = vi.fn(async () => {});
    const pipeline = new ManagedPastePipeline({
        app,
        getSettings: () => settings,
        uploadService: { uploadFile, uploadData } as unknown as UploadService,
        refConverter: { parseReferences } as unknown as RefConverter,
        buildUploadedReference: (url, _vars, alt = '') => `![${alt}](${url})`,
        getReferenceTemplateFileVars: async () => ({
            fileName: 'managed-image.png',
            fileBaseName: 'managed-image',
            fileExt: 'png',
        }),
        replaceReferenceInNotes,
        getDefaultHostingConfig: () => settings.hostingConfigs[0] ?? null,
        getIndeterminateImagePaths: () => new Set(),
    });
    const image = {
        type: 'image/png',
        arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
    } as File;
    return {
        pipeline, settings, createFolder, createBinary, editor, image,
        uploadFile, uploadData, replaceReferenceInNotes,
        getContent: () => content,
    };
}

describe('ManagedPastePipeline', () => {
    it('saves a managed image and inserts an encoded note-relative Markdown reference', async () => {
        const target = harness({ imagePathBase: 'note' });
        const note = file('notes/note.md', 'notes');

        target.pipeline.processFiles([target.image], target.editor, note);

        await vi.waitFor(() => expect(target.createBinary).toHaveBeenCalledOnce());
        expect(target.createFolder).toHaveBeenCalledWith('notes');
        expect(target.createFolder).toHaveBeenCalledWith('notes/attachments');
        expect(target.createBinary).toHaveBeenCalledWith(
            'notes/attachments/managed-image.png',
            expect.any(ArrayBuffer)
        );
        expect(target.getContent()).toBe('![managed-image.png](attachments/managed-image.png)');
    });

    it('does not read the delegated auto-upload preference in managed mode', async () => {
        const target = harness({
            managedAutoUploadOnPaste: false,
            delegatedAutoUploadOnPaste: true,
            hostingConfigs: [{ id: 'host', enabled: true }] as never,
        });

        target.pipeline.processFiles([target.image], target.editor, file('note.md'));

        await vi.waitFor(() => expect(target.createBinary).toHaveBeenCalledOnce());
        expect(target.uploadFile).not.toHaveBeenCalled();
        expect(target.uploadData).not.toHaveBeenCalled();
    });

    it('replaces only the inserted managed reference after auto upload', async () => {
        const target = harness({
            managedAutoUploadOnPaste: true,
            compressBeforeUpload: false,
            hostingConfigs: [{
                id: 'host',
                name: 'Host',
                type: 'custom',
                enabled: true,
                config: {
                    uploadUrl: 'https://upload.test',
                    method: 'POST',
                    headers: {},
                    fileFieldName: 'file',
                    jsonPath: 'url',
                    extraBody: {},
                },
                uploadPath: '',
                urlPrefix: '',
            }],
        });
        target.uploadData.mockResolvedValue({ success: true, url: 'https://cdn.test/managed.png' });
        const note = file('note.md');

        target.pipeline.processFiles([target.image], target.editor, note);

        await vi.waitFor(() => expect(target.getContent()).toBe(
            '![managed-image.png](https://cdn.test/managed.png)'
        ));
        expect(target.uploadFile).not.toHaveBeenCalled();
        expect(target.uploadData).toHaveBeenCalledWith(
            expect.any(ArrayBuffer),
            'managed-image.png',
            target.settings.hostingConfigs[0],
            { sourcePath: 'attachments/managed-image.png' }
        );
        expect(target.replaceReferenceInNotes).toHaveBeenCalledOnce();
    });

    it('resolves an encoded Markdown path after naming a managed image with special characters', async () => {
        const target = harness({
            imageNamingTemplate: '这是图片？！1！#！#¥！#',
            managedAutoUploadOnPaste: true,
            compressBeforeUpload: false,
            hostingConfigs: [{
                id: 'host',
                name: 'Host',
                type: 'custom',
                enabled: true,
                config: {
                    uploadUrl: 'https://upload.test',
                    method: 'POST',
                    headers: {},
                    fileFieldName: 'file',
                    jsonPath: 'url',
                    extraBody: {},
                },
                uploadPath: '',
                urlPrefix: '',
            }],
        });
        target.uploadData.mockResolvedValue({ success: true, url: 'https://cdn.test/special.png' });
        const note = file('idea配置.gitignore文件后不生效.md');

        target.pipeline.processFiles([target.image], target.editor, note);

        await vi.waitFor(() => expect(target.uploadData).toHaveBeenCalledOnce());
        await vi.waitFor(() => expect(target.getContent()).toBe(
            '![这是图片？！1！#！#¥！#.png](https://cdn.test/special.png)'
        ));
    });

    it('keeps path resolution available to reorganization through the same pipeline', () => {
        const target = harness({ imagePathBase: 'note' });
        const note = file('projects/demo/note.md', 'projects/demo');

        expect(target.pipeline.resolveImagePath('assets/{noteName}', note, 'image.png'))
            .toBe('projects/demo/assets/note');
    });
});
