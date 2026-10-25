import { describe, expect, it, vi } from 'vitest';
import { CardElement } from './helpers/card-dom';

vi.mock('obsidian', () => ({
    Modal: class {},
    Notice: class {},
    TFile: class {},
    MarkdownView: class {},
    requestUrl: vi.fn(() => { throw new Error('Unexpected provider request'); }),
}));
vi.mock('../src/i18n', () => ({ t: (key: string) => key }));
vi.mock('../src/utils/path-utils', () => ({ formatFileSize: () => '0 B' }));

import { MarkdownView, TFile, type App, type Editor } from 'obsidian';
import type ImageManagerPlugin from '../src/main';
import type { RefConverter } from '../src/utils/ref-converter';
import type { ImageHostingConfig } from '../src/types';
import { RemoteReferenceIndex } from '../src/remote/reference-index';
import { RemoteImageBrowserView } from '../src/modals/remote-image-browser';

function createBrowser() {
    const files = ['one.md', 'two.md'].map(path => Object.assign(new TFile(), {
        path, extension: 'md', stat: { mtime: 1, ctime: 1, size: 0 },
    }));
    const view = Object.assign(Object.create(MarkdownView.prototype) as MarkdownView, {
        file: files[0]!, editor: { getValue: () => '' } as Editor,
    });
    const views = [view];
    const app = {
        workspace: { getLeavesOfType: () => views.map(view => ({ view })), getActiveViewOfType: () => null },
        vault: {
            getMarkdownFiles: () => files,
            getAbstractFileByPath: (path: string) => files.find(file => file.path === path),
            read: async () => '',
        },
    } as unknown as App;
    const index = new RemoteReferenceIndex(app, { parseReferences: () => [] } as unknown as RefConverter);
    const config: ImageHostingConfig = {
        id: 'test', name: 'Test', type: 's3', enabled: true,
        uploadPath: '', urlPrefix: 'https://example.invalid/',
        config: {
            endpoint: 'https://example.invalid', region: 'auto',
            accessKeyId: 'test', secretAccessKey: 'test', bucket: 'test', forcePathStyle: true,
        },
        remoteManagement: {
            enabled: true, prefix: '', previewAccess: 'presigned', publicUrlAliases: [],
            pageSize: 100, previewMode: 'viewport',
        },
    };
    const plugin = {
        settings: {
            hostingConfigs: [config], remoteImageBrowserSort: { field: 'key', order: 'asc' },
            supportedExtensions: ['png'],
        },
        remoteReferenceIndex: index,
        uploadService: { onSuccess: () => () => {} },
    } as unknown as ImageManagerPlugin;
    const root = new CardElement();
    const browser = new RemoteImageBrowserView(app, plugin, root.asElement());
    return { browser, index, root, files, view, views };
}

describe('remote browser reference invalidation', () => {
    it.each(['open', 'close', 'rebind'] as const)('renders one set of controls after editor %s without an event', async change => {
        const f = createBrowser();
        await f.index.scan();
        if (change === 'open') f.views.push(Object.assign(Object.create(MarkdownView.prototype) as MarkdownView, {
            file: f.files[1]!, editor: { getValue: () => '' } as Editor,
        }));
        if (change === 'close') f.views.length = 0;
        if (change === 'rebind') f.view.file = f.files[1]!;

        try {
            f.browser.open();
            const expectSingleControls = () => {
                for (const selector of [
                    '.remote-image-browser-reference-status', '.remote-delete-toolbar',
                    '.remote-image-browser-page-tools', '.remote-image-browser-page-results',
                ]) expect(f.root.querySelectorAll(selector)).toHaveLength(1);
            };
            expectSingleControls();
            expect(f.index.getState().status).toBe('stale');
            await Promise.resolve();
            expectSingleControls();
        } finally {
            f.browser.close();
        }
    });

    it('does not render again after closing with an invalidation pending', async () => {
        const f = createBrowser();
        await f.index.scan();
        f.browser.open();
        f.views.length = 0;
        expect(f.index.getState().status).toBe('stale');
        f.browser.close();
        await Promise.resolve();
        expect(f.root.children).toHaveLength(0);
    });
});
