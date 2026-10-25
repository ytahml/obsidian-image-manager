import { describe, expect, it, vi } from 'vitest';

const { providerUpload, compressImage } = vi.hoisted(() => ({
    providerUpload: vi.fn(),
    compressImage: vi.fn(),
}));

vi.mock('obsidian', () => ({
    Notice: class Notice {
        hide(): void {}
    },
    TFile: class TFile {},
    MarkdownView: class MarkdownView {},
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
vi.mock('../src/uploaders/uploader-factory', () => ({
    createUploader: () => ({ upload: providerUpload }),
}));
vi.mock('../src/utils/image-optimizer', () => ({
    ImageOptimizer: class { compressImage = compressImage; },
}));

import { MarkdownView, TFile, type App, type Editor } from 'obsidian';
import { ManagedPastePipeline } from '../src/lifecycle/managed-paste-pipeline';
import { DEFAULT_SETTINGS, type ImageManagerSettings, type ImageReference } from '../src/types';
import type { RefConverter } from '../src/utils/ref-converter';
import { UploadService } from '../src/uploaders/upload-service';

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

function harness(overrides: Partial<ImageManagerSettings> = {}, useRealUploadService = false) {
    const settings: ImageManagerSettings = {
        ...DEFAULT_SETTINGS,
        imageNamingTemplate: 'managed image',
        imagePathTemplate: 'attachments',
        compressManagedPasteLocal: false,
        managedAutoUploadOnPaste: false,
        ...overrides,
    };
    const files = new Map<string, TFile>();
    const views: MarkdownView[] = [];
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
    const trashFile = vi.fn();
    const app = {
        workspace: { getLeavesOfType: () => views.map(view => ({ view })), getActiveViewOfType: () => null },
        vault: {
            adapter: { exists: async () => false },
            getAbstractFileByPath: (path: string) => files.get(path) ?? null,
            createFolder,
            createBinary,
            readBinary: async () => new Uint8Array([1, 2, 3]).buffer,
        },
        metadataCache: {
            getFirstLinkpathDest: (path: string) =>
                Array.from(files.values()).find((candidate) => candidate.name === path || candidate.path === path) ?? null,
        },
        fileManager: { trashFile },
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
    const replaceReferenceInNotes = vi.fn(async () => 0);
    const prepareReference = vi.fn(async () => ({
        render: (url: string, alt = '') => `![${alt}](${url})`,
    }));
    const uploadService = useRealUploadService
        ? new UploadService(app, () => settings)
        : { uploadFile, uploadData } as unknown as UploadService;
    const pipeline = new ManagedPastePipeline({
        app,
        getSettings: () => settings,
        uploadService,
        refConverter: { parseReferences } as unknown as RefConverter,
        uploadReferences: {
            prepare: prepareReference,
            replaceVaultReferences: replaceReferenceInNotes,
        },
        getDefaultHostingConfig: () => settings.hostingConfigs[0] ?? null,
        getIndeterminateImagePaths: () => new Set(),
    });
    const image = {
        type: 'image/png',
        arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
    } as File;
    const bind = (note: TFile) => {
        files.set(note.path, note);
        views.splice(0, views.length, Object.assign(Object.create(MarkdownView.prototype) as MarkdownView, { file: note, editor }));
    };
    return {
        pipeline, settings, createFolder, createBinary, editor, image,
        files, views, bind, trashFile,
        uploadFile, uploadData, uploadService, replaceReferenceInNotes,
        getContent: () => content,
    };
}

describe('ManagedPastePipeline', () => {
    it('saves a managed image and inserts an encoded note-relative Markdown reference', async () => {
        const target = harness({ imagePathBase: 'note' });
        const note = file('notes/note.md', 'notes');
        target.bind(note);

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

        const note = file('note.md');
        target.bind(note);
        target.pipeline.processFiles([target.image], target.editor, note);

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
        target.bind(note);

        target.pipeline.processFiles([target.image], target.editor, note);

        await vi.waitFor(() => expect(target.getContent()).toBe(
            '![managed-image.png](https://cdn.test/managed.png)'
        ));
        expect(target.uploadFile).not.toHaveBeenCalled();
        expect(target.uploadData).toHaveBeenCalledWith(
            expect.any(ArrayBuffer),
            'managed-image.png',
            target.settings.hostingConfigs[0],
            { sourcePath: 'attachments/managed-image.png' },
            expect.any(Object)
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
        target.bind(note);

        target.pipeline.processFiles([target.image], target.editor, note);

        await vi.waitFor(() => expect(target.uploadData).toHaveBeenCalledOnce());
        await vi.waitFor(() => expect(target.getContent()).toBe(
            '![这是图片？！1！#！#¥！#.png](https://cdn.test/special.png)'
        ));
    });

    describe.each(['vault', 'note'] as const)('literal paths relative to %s', (imagePathBase) => {
        it.each(['$&', '$`', "$'", '$$'])('keeps %s literal in every path variable', (literal) => {
            const target = harness({ imagePathBase });
            const directory = `folder${literal}`;
            const note = file(`${directory}/note${literal}.md`, directory);
            const expected = `assets/${directory}/note${literal}/image${literal}.png`;

            expect(target.pipeline.resolveImagePath(
                'assets/{notePath}/{noteName}/{filename}', note, `image${literal}.png`
            )).toBe(imagePathBase === 'note' ? `${directory}/${expected}` : expected);
        });
    });

    it('does not expand template-shaped note paths or filenames a second time', () => {
        const target = harness({ imagePathBase: 'vault' });
        const note = file('notes{year}/note{month}.md', 'notes{year}');

        expect(target.pipeline.resolveImagePath(
            '{notePath}/{noteName}/{filename}/{year}', note, 'image{day}.png'
        )).toBe(`notes{year}/note{month}/image{day}.png/${new Date().getFullYear()}`);
    });

    it('saves and references a note-derived literal filename through the managed pipeline', async () => {
        const target = harness({
            imagePathBase: 'note',
            imageNamingTemplate: '{noteName}',
            imagePathTemplate: 'assets/{noteName}',
        });
        const note = file('notes/report$&{year}.md', 'notes');
        target.bind(note);

        target.pipeline.processFiles([target.image], target.editor, note);

        await vi.waitFor(() => expect(target.createBinary).toHaveBeenCalledOnce());
        expect(target.createBinary).toHaveBeenCalledWith(
            'notes/assets/report$&{year}/report$&{year}.png', expect.any(ArrayBuffer)
        );
        expect(target.getContent()).toBe(
            '![report$&{year}.png](assets/report$&%7Byear%7D/report$&%7Byear%7D.png)'
        );
    });

    it('keeps path resolution available to reorganization through the same pipeline', () => {
        const target = harness({ imagePathBase: 'note' });
        const note = file('projects/demo/note.md', 'projects/demo');

        expect(target.pipeline.resolveImagePath('assets/{noteName}', note, 'image.png'))
            .toBe('projects/demo/assets/note');
    });

    it.each(['switch', 'close', 'delete'] as const)('does not insert or upload after source %s during save', async (change) => {
        const target = harness({ managedAutoUploadOnPaste: true, hostingConfigs: [{ id: 'host', enabled: true }] as never });
        const note = file('first.md');
        target.bind(note);
        const create = target.createBinary.getMockImplementation()!;
        target.createBinary.mockImplementation(async (path: string) => {
            if (change === 'switch') target.bind(file('second.md'));
            if (change === 'close') target.views.length = 0;
            if (change === 'delete') target.files.delete(note.path);
            return create(path);
        });

        target.pipeline.processFiles([target.image], target.editor, note);

        await vi.waitFor(() => expect(target.createBinary).toHaveBeenCalledOnce());
        expect(target.getContent()).toBe('');
        expect(target.files.has('attachments/managed-image.png')).toBe(true);
        expect(target.uploadData).not.toHaveBeenCalled();
        expect(target.uploadFile).not.toHaveBeenCalled();
        expect(target.trashFile).not.toHaveBeenCalled();
    });

    it('does not replace an identical reference in a different note after upload completes', async () => {
        const target = harness({ managedAutoUploadOnPaste: true, hostingConfigs: [{ id: 'host', enabled: true }] as never });
        const source = file('first.md');
        target.bind(source);
        let finish: (result: { success: boolean; url: string }) => void = () => {};
        target.uploadData.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
        target.pipeline.processFiles([target.image], target.editor, source);
        await vi.waitFor(() => expect(target.uploadData).toHaveBeenCalledOnce());
        const local = target.getContent();
        target.bind(file('second.md'));
        finish({ success: true, url: 'https://cdn.test/image.png' });
        await vi.waitFor(() => expect(target.uploadData.mock.settledResults[0]?.type).toBe('fulfilled'));

        expect(target.getContent()).toBe(local);
        expect(target.replaceReferenceInNotes).not.toHaveBeenCalled();
        expect(target.trashFile).not.toHaveBeenCalled();
    });

    it.each(['switch', 'close', 'delete'] as const)('does not send an upload after source %s during compression', async change => {
        providerUpload.mockReset().mockResolvedValue({ success: true, url: 'https://cdn.test/image.png' });
        let finishCompression: (value: { data: ArrayBuffer }) => void = () => {};
        compressImage.mockReset().mockImplementation(() => new Promise(resolve => { finishCompression = resolve; }));
        const target = harness({
            managedAutoUploadOnPaste: true,
            compressBeforeUpload: true,
            managedKeepLocalCopy: false,
            hostingConfigs: [{ id: 'host', type: 'custom', enabled: true }] as never,
        }, true);
        const upload = vi.spyOn(target.uploadService, 'uploadFile');
        const source = file('first.md');
        target.bind(source);
        target.pipeline.processFiles([target.image], target.editor, source);
        await vi.waitFor(() => expect(compressImage).toHaveBeenCalledOnce());
        const local = target.getContent();
        if (change === 'switch') target.bind(file('second.md'));
        if (change === 'close') target.views.length = 0;
        if (change === 'delete') target.files.delete(source.path);
        finishCompression({ data: new Uint8Array([1]).buffer });
        const operation = upload.mock.results[0];
        if (operation?.type !== 'return') throw new Error('Expected an upload promise');
        const result = await operation.value;

        expect(providerUpload).not.toHaveBeenCalled();
        expect(result).toMatchObject({ success: false, cancelled: true, attempts: 0 });
        expect(target.getContent()).toBe(local);
        expect(target.files.has('attachments/managed-image.png')).toBe(true);
        expect(target.replaceReferenceInNotes).not.toHaveBeenCalled();
        expect(target.trashFile).not.toHaveBeenCalled();
    });

    it('uploads compressed data through the service while the source remains bound', async () => {
        providerUpload.mockReset().mockResolvedValue({ success: true, url: 'https://cdn.test/image.png' });
        compressImage.mockReset().mockResolvedValue({ data: new Uint8Array([1]).buffer });
        const target = harness({
            managedAutoUploadOnPaste: true,
            compressBeforeUpload: true,
            managedKeepLocalCopy: true,
            hostingConfigs: [{ id: 'host', type: 'custom', enabled: true }] as never,
        }, true);
        const source = file('first.md');
        target.bind(source);
        target.pipeline.processFiles([target.image], target.editor, source);
        await vi.waitFor(() => expect(target.getContent()).toBe('![managed-image.png](https://cdn.test/image.png)'));
        expect(providerUpload).toHaveBeenCalledOnce();
        expect(target.replaceReferenceInNotes).toHaveBeenCalledOnce();
        expect(target.trashFile).not.toHaveBeenCalled();
    });
});
