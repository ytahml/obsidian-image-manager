import { describe, expect, it, vi } from 'vitest';
vi.mock('obsidian', () => ({ App: class {}, TFile: class {}, MarkdownView: class {}, normalizePath: (s: string) => s }));
import { TFile, type App } from 'obsidian';
import { RefConverter } from '../src/utils/ref-converter';
import { RemoteReferenceIndex } from '../src/remote/reference-index';
import { getRemoteDeleteUnavailableReason } from '../src/remote/delete-policy';
import { RemoteDeleteSession } from '../src/remote/delete-session';
import type { ImageHostingConfig } from '../src/types';
import type { RemoteObjectProvider } from '../src/remote/provider';

describe('Remote Markdown syntax deletion safety', () => {
    it.each([
        ['normal control', '![](https://cdn.test/photo.png)', 'photo.png'],
        ['image title', '![](https://cdn.test/photo.png "caption")', 'photo.png'],
        ['balanced parentheses', '![](https://cdn.test/photo(1).png)', 'photo(1).png'],
        ['angle URL with spaces', '![](<https://cdn.test/photo (1).png> "caption")', 'photo (1).png'],
        ['nested parentheses', '![](https://cdn.test/photo((1)).png)', 'photo((1)).png'],
        ['adjacent images', '![](https://cdn.test/other.png)![](https://cdn.test/photo(1).png)', 'photo(1).png'],
        ['single quote title', "![](https://cdn.test/photo.png 'caption')", 'photo.png'],
    ])('%s remains protected from deletion', async (_name, content, key) => {
        const note = Object.assign(new TFile(), { path: 'note.md', extension: 'md', stat: { mtime: 1, size: content.length } });
        const app = { workspace: { getLeavesOfType: () => [], getActiveViewOfType: () => null },
            vault: { getMarkdownFiles: () => [note], getAbstractFileByPath: () => note,
                read: async () => content, cachedRead: async () => content } } as unknown as App;
        const index = new RemoteReferenceIndex(app, new RefConverter(app));
        await index.scan();
        const lookup = index.createLookup({ hostingId: 'host', urlPrefix: 'https://cdn.test', publicUrlAliases: [] });
        const object = { hostingId: 'host', key, size: 1 };
        const config = { id: 'host', type: 's3', enabled: true, urlPrefix: 'https://cdn.test',
            config: { endpoint: 'https://storage.test', region: 'test', bucket: 'images', forcePathStyle: true },
            remoteManagement: { enabled: true, prefix: '', publicUrlAliases: [] } } as unknown as ImageHostingConfig;
        const provider = { capabilities: new Set(['list', 'delete']), listObjects: vi.fn(), deleteObject: vi.fn() } as RemoteObjectProvider;
        const context = { config, provider, indexState: index.getState(), scannedObjects: [object], classify: (target: typeof object) => lookup.classify(target) };
        const session = new RemoteDeleteSession();
        const selection = session.setSelected(object, true, context);
        const batch = session.createBatch(context);
        expect(lookup.classify(object)).toBe('referenced');
        expect(getRemoteDeleteUnavailableReason(object, context)).toBe('referenced');
        expect(selection.selected).toBe(false);
        expect(batch).toBeUndefined();
    });
});
