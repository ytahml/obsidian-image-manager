import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('obsidian', () => ({
    MarkdownView: class MarkdownView {},
    Notice: class Notice {},
    TFile: class TFile {},
}));

import { MarkdownView, TFile, type App, type Editor } from 'obsidian';
import { DEFAULT_SETTINGS, type ImageManagerSettings, type ImageReference } from '../src/types';
import { ObsidianDelegatedHandoff } from '../src/lifecycle/obsidian-delegated-handoff';
import type { UploadService } from '../src/uploaders/upload-service';
import type { RefConverter } from '../src/utils/ref-converter';

function file(path: string): TFile {
    const target = new TFile();
    target.path = path;
    target.name = path.split('/').pop()!;
    target.extension = target.name.split('.').pop()!;
    return target;
}

function parseReferences(content: string): ImageReference[] {
    const references: ImageReference[] = [];
    const pattern = /!\[([^\]]*)\]\(([^)]+)\)/g;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(content)) !== null) {
        references.push({
            fullMatch: match[0],
            altText: match[1]!,
            path: match[2]!,
            format: 'markdown',
            line: 0,
            col: match.index,
        });
    }
    return references;
}

async function flushPromises(): Promise<void> {
    for (let index = 0; index < 12; index++) await Promise.resolve();
}

function harness(initialContent = '') {
    let content = initialContent;
    const note = file('note.md');
    const files = new Map<string, TFile>([[note.path, note]]);
    const settings: ImageManagerSettings = {
        ...DEFAULT_SETTINGS,
        localManagementMode: 'delegated',
        autoUploadOnPaste: true,
        keepLocalCopy: true,
        defaultHostingId: 'host',
        hostingConfigs: [{
            id: 'host', name: 'host', type: 'custom', enabled: true,
            config: { uploadUrl: 'https://example.test', method: 'POST', headers: {}, fileFieldName: 'file', jsonPath: '', extraBody: {} },
            uploadPath: '', urlPrefix: '',
        }],
    };
    const editor = {
        getValue: () => content,
        replaceRange: (replacement: string, start: { ch: number }, end: { ch: number }) => {
            content = content.substring(0, start.ch) + replacement + content.substring(end.ch);
        },
    } as unknown as Editor;
    const view = new (MarkdownView as unknown as { new(): MarkdownView })();
    view.file = note;
    view.editor = editor;
    const app = {
        workspace: { getLeavesOfType: () => [{ view }] },
        metadataCache: {
            getFirstLinkpathDest: (path: string) => files.get(path) ?? files.get(`attachments/${path}`) ?? null,
        },
        vault: {
            read: async () => content,
            getAbstractFileByPath: (path: string) => files.get(path) ?? null,
            process: async (_target: TFile, update: (current: string) => string) => { content = update(content); },
            getFiles: () => Array.from(files.values()),
            getMarkdownFiles: () => [note],
            cachedRead: async () => content,
        },
        fileManager: { trashFile: vi.fn() },
    } as unknown as App;
    const uploadFile = vi.fn();
    const notice = vi.fn();
    const handoff = new ObsidianDelegatedHandoff({
        app,
        getSettings: () => settings,
        uploadService: { uploadFile } as unknown as UploadService,
        refConverter: { parseReferences } as unknown as RefConverter,
        isImageFile: (target) => target.extension === 'png',
        buildUploadedReference: (url) => `![](${url})`,
        getReferenceTemplateFileVars: async () => ({ fileName: 'a.png', fileBaseName: 'a', fileExt: 'png' }),
        getDefaultHostingConfig: () => settings.hostingConfigs.find((config) => config.id === settings.defaultHostingId && config.enabled) ?? null,
        notice,
        beginIndeterminate: vi.fn(),
        touchIndeterminate: vi.fn(),
        endIndeterminate: vi.fn(),
    });
    return {
        handoff, note, editor, settings, files, uploadFile, notice,
        setContent: (next: string) => { content = next; },
        getContent: () => content,
    };
}

describe('ObsidianDelegatedHandoff', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        // Vitest runs without an Obsidian window; expose its fake-timer host to the adapter.
        // eslint-disable-next-line obsidianmd/no-global-this
        vi.stubGlobal('window', globalThis);
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.unstubAllGlobals();
    });

    it('does not claim a pre-existing broken reference when an unrelated file later makes it resolvable', async () => {
        const target = harness('![](a.png)');
        const image = file('a.png');
        target.handoff.start(target.editor, target.note, 1);
        target.files.set(image.path, image);

        target.handoff.onCreate(image);
        await vi.advanceTimersByTimeAsync(1_200);

        expect(target.uploadFile).not.toHaveBeenCalled();
        target.handoff.cancelAll('unload');
    });

    it('fails closed when more newly referenced files appear than the paste transaction contains', async () => {
        const target = harness();
        const unrelated = file('unrelated.png');
        const pasted = file('pasted.png');
        target.handoff.start(target.editor, target.note, 1);
        target.files.set(unrelated.path, unrelated);
        target.handoff.onCreate(unrelated);
        target.setContent('![](unrelated.png)');
        target.handoff.onModify(target.note);
        target.files.set(pasted.path, pasted);
        target.handoff.onCreate(pasted);
        target.setContent('![](unrelated.png)\n![](pasted.png)');
        target.handoff.onModify(target.note);
        await vi.advanceTimersByTimeAsync(1_200);

        expect(target.uploadFile).not.toHaveBeenCalled();
        expect(target.notice).toHaveBeenCalledTimes(1);
    });

    it('does not apply a successful remote result after relevant settings drift', async () => {
        const target = harness();
        const image = file('a.png');
        let finishUpload!: (result: { success: boolean; url: string }) => void;
        target.uploadFile.mockReturnValue(new Promise((resolve) => { finishUpload = resolve; }));
        target.handoff.start(target.editor, target.note, 1);
        target.files.set(image.path, image);
        target.handoff.onCreate(image);
        target.setContent('![](a.png)');
        target.handoff.onModify(target.note);
        await vi.advanceTimersByTimeAsync(1_200);
        expect(target.uploadFile).toHaveBeenCalledTimes(1);

        target.settings.keepLocalCopy = false;
        finishUpload({ success: true, url: 'https://cdn.test/a.png' });
        await flushPromises();

        expect(target.getContent()).toBe('![](a.png)');
        expect(target.notice).toHaveBeenCalledTimes(1);
    });

    it('invalidates an in-flight result when the claimed attachment is renamed', async () => {
        const target = harness();
        const image = file('a.png');
        let finishUpload!: (result: { success: boolean; url: string }) => void;
        target.uploadFile.mockReturnValue(new Promise((resolve) => { finishUpload = resolve; }));
        target.handoff.start(target.editor, target.note, 1);
        target.files.set(image.path, image);
        target.handoff.onCreate(image);
        target.setContent('![](a.png)');
        target.handoff.onModify(target.note);
        await vi.advanceTimersByTimeAsync(1_200);

        target.files.delete('a.png');
        image.path = 'moved/a.png';
        image.name = 'a.png';
        target.files.set(image.path, image);
        target.setContent('![](moved/a.png)');
        target.handoff.onRename(image);
        finishUpload({ success: true, url: 'https://cdn.test/a.png' });
        await flushPromises();

        expect(target.getContent()).toBe('![](moved/a.png)');
        expect(target.notice).toHaveBeenCalledTimes(1);
    });

    it('does not add an older transaction candidate to a transaction started before its later rename', async () => {
        const target = harness();
        const image = file('a.png');
        target.uploadFile.mockResolvedValue({ success: true, url: 'https://cdn.test/a.png' });
        target.handoff.start(target.editor, target.note, 1);
        target.files.set(image.path, image);
        target.handoff.onCreate(image);
        target.setContent('![](a.png)');
        target.handoff.onModify(target.note);

        target.handoff.start(target.editor, target.note, 1);
        target.files.delete('a.png');
        image.path = 'moved/a.png';
        target.files.set(image.path, image);
        target.setContent('![](moved/a.png)');
        target.handoff.onRename(image);
        await vi.advanceTimersByTimeAsync(1_200);
        await flushPromises();

        expect(target.uploadFile).toHaveBeenCalledTimes(1);
        expect(target.getContent()).toBe('![](https://cdn.test/a.png)');
        target.handoff.cancelAll('unload');
    });
});
