import { describe, expect, it, vi } from 'vitest';
vi.mock('obsidian', () => ({ MarkdownView: class MarkdownView {}, TFile: class TFile {}, normalizePath: (path: string) => path.replace(/^\/+|\/+$/g, '') }));
import { MarkdownView, TFile, type App, type WorkspaceLeaf } from 'obsidian';
import type { ImageHostingConfig } from '../src/types';
import { RefConverter } from '../src/utils/ref-converter';
import { ExplicitUploadWorkflow } from '../src/uploaders/explicit-upload-workflow';
import type { UploadService } from '../src/uploaders/upload-service';
import { UploadReferenceManager } from '../src/uploaders/upload-reference-manager';
import { createUploadPlan } from '../src/uploaders/upload-scope';

function file(path: string): TFile {
    return Object.assign(new TFile(), { path, name: path.split('/').pop(), basename: path.split('/').pop()?.split('.')[0], extension: path.split('.').pop(), stat: { mtime: 1, size: 10 }, parent: null });
}
const hosting = { id: 'h', type: 'custom', enabled: true } as ImageHostingConfig;
function fixture() {
    const image = file('assets/photo.png'), second = file('other/photo.png');
    const note = file('notes/a.md'), outside = file('outside.md');
    const files = [image, second, note, outside];
    const contents = new Map([[note.path, '![first](assets/photo.png)\n![[assets/photo.png|second]]'], [outside.path, '![[assets/photo.png]]\n![[other/photo.png]]']]);
    const leaves: WorkspaceLeaf[] = [];
    const process = vi.fn(async (f: TFile, update: (value: string) => string) => { contents.set(f.path, update(contents.get(f.path)!)); });
    const app = {
        workspace: { getActiveViewOfType: () => null, getLeavesOfType: () => leaves },
        metadataCache: { getFirstLinkpathDest: (path: string) => files.find(f => f.path === path) ?? null },
        vault: { getFiles: () => files, getMarkdownFiles: () => [note, outside],
            getAbstractFileByPath: (path: string) => files.find(f => f.path === path),
            read: async (f: TFile) => contents.get(f.path)!, process },
    } as unknown as App;
    const converter = new RefConverter(app);
    const manager = new UploadReferenceManager({ app, refConverter: converter, getDefaultTemplate: () => '', getImageInfo: async () => ({ width: 10, height: 20 }) });
    const uploadFile = vi.fn(async (f: TFile) => ({ success: true, url: `https://cdn/${f.path}`, originalPath: f.name, attempts: 1, hostingId: 'h', hostingType: 'custom' as const }));
    const workflow = new ExplicitUploadWorkflow(app, { uploadFile } as unknown as UploadService, converter, manager);
    return { app, converter, workflow, image, second, note, outside, contents, process, uploadFile, leaves };
}

describe('scoped explicit uploads', () => {
    it('uploads once and replaces every occurrence, including notes outside scope without touching same-name files', async () => {
        const f = fixture();
        const plan = await createUploadPlan(f.app, f.converter, { kind: 'note', path: f.note.path }, ['png']);
        const result = await f.workflow.uploadPlan(plan, hosting, { replaceReferences: true });
        expect(f.uploadFile).toHaveBeenCalledTimes(1);
        expect(f.process).toHaveBeenCalledTimes(2);
        expect(result).toMatchObject({ totalImages: 1, successfulImages: 1, updatedNotes: 2, replacedReferences: 3, outsideScopeNotes: 1, failures: [] });
        expect(f.contents.get(f.note.path)).toBe('![first](https://cdn/assets/photo.png)\n![second](https://cdn/assets/photo.png)');
        expect(f.contents.get(f.outside.path)).toContain('![[other/photo.png]]');
    });
    it('does no writes when replacement is off', async () => {
        const f = fixture();
        const plan = await createUploadPlan(f.app, f.converter, { kind: 'vault' }, ['png']);
        const result = await f.workflow.uploadPlan(plan, hosting, { replaceReferences: false });
        expect(result.successfulImages).toBe(2);
        expect(f.process).not.toHaveBeenCalled();
    });
    it('uses current text after upload and preserves new user edits', async () => {
        const f = fixture();
        f.uploadFile.mockImplementation(async image => {
            f.contents.set(f.note.path, `new user text\n${f.contents.get(f.note.path)}`);
            return { success: true, url: `https://cdn/${image.path}`, originalPath: image.name, attempts: 1, hostingId: 'h', hostingType: 'custom' };
        });
        const plan = await createUploadPlan(f.app, f.converter, { kind: 'note', path: f.note.path }, ['png']);
        await f.workflow.uploadPlan(plan, hosting, { replaceReferences: true });
        expect(f.contents.get(f.note.path)).toMatch(/^new user text\n!\[first\]\(https:/);
    });
    it('skips conflicting saved writes and still updates other notes', async () => {
        const f = fixture();
        f.process.mockImplementation(async (note, update) => {
            const current = note === f.note ? 'concurrent edit' : f.contents.get(note.path)!;
            f.contents.set(note.path, update(current));
        });
        const plan = await createUploadPlan(f.app, f.converter, { kind: 'note', path: f.note.path }, ['png']);
        const result = await f.workflow.uploadPlan(plan, hosting, { replaceReferences: true });
        expect(result.failures).toEqual([{ notePath: f.note.path, reason: 'conflict' }]);
        expect(result.updatedNotes).toBe(1);
        expect(f.contents.get(f.note.path)).toBe('concurrent edit');
    });
    it('does not adopt a successful upload after its source changes', async () => {
        const f = fixture();
        f.uploadFile.mockImplementation(async image => {
            image.stat.mtime++;
            return { success: true, url: 'https://cdn/photo.png', originalPath: image.name, attempts: 1, hostingId: 'h', hostingType: 'custom' };
        });
        const plan = await createUploadPlan(f.app, f.converter, { kind: 'note', path: f.note.path }, ['png']);
        const result = await f.workflow.uploadPlan(plan, hosting, { replaceReferences: true });
        expect(result).toMatchObject({ successfulImages: 1, unusedImages: 1, replacedReferences: 0 });
        expect(f.process).not.toHaveBeenCalled();
    });
    it('writes through non-active open editors, not behind them via Vault', async () => {
        const f = fixture();
        let text = f.contents.get(f.note.path)! + '\nunsaved';
        const editor = { getValue: () => text, offsetToPos: () => ({ line: 2, ch: 7 }), replaceRange: vi.fn((next: string) => { text = next; }) };
        f.leaves.push({ view: Object.assign(new MarkdownView({} as WorkspaceLeaf), { file: f.note, editor }) } as unknown as WorkspaceLeaf);
        const plan = await createUploadPlan(f.app, f.converter, { kind: 'note', path: f.note.path }, ['png']);
        await f.workflow.uploadPlan(plan, hosting, { replaceReferences: true });
        expect(editor.replaceRange).toHaveBeenCalledOnce();
        expect(text).toContain('https://cdn/');
        expect(text).toContain('unsaved');
        expect(f.process.mock.calls.every(call => call[0] !== f.note)).toBe(true);
    });
    it('reports write failures separately from successful uploads', async () => {
        const f = fixture();
        f.process.mockRejectedValue(new Error('private provider detail'));
        const plan = await createUploadPlan(f.app, f.converter, { kind: 'note', path: f.note.path }, ['png']);
        const result = await f.workflow.uploadPlan(plan, hosting, { replaceReferences: true });
        expect(result.successfulImages).toBe(1);
        expect(result.failures).toHaveLength(2);
        expect(JSON.stringify(result.failures)).not.toContain('private');
    });
    it('keeps failed image references while updating independent successes', async () => {
        const f = fixture();
        f.uploadFile.mockImplementation(async image => {
            if (image === f.second) throw new Error('upload failed');
            return { success: true, url: 'https://cdn/photo.png', originalPath: image.name, attempts: 1, hostingId: 'h', hostingType: 'custom' };
        });
        const plan = await createUploadPlan(f.app, f.converter, { kind: 'vault' }, ['png']);
        const result = await f.workflow.uploadPlan(plan, hosting, { replaceReferences: true });
        expect(result).toMatchObject({ successfulImages: 1, failedImages: 1, replacedReferences: 3 });
        expect(f.contents.get(f.outside.path)).toContain('![[other/photo.png]]');
    });
    it('skips a note when two open editors disagree', async () => {
        const f = fixture();
        const plan = await createUploadPlan(f.app, f.converter, { kind: 'note', path: f.note.path }, ['png']);
        const writes = vi.fn();
        for (const text of ['![[assets/photo.png]]', 'different edit']) {
            f.leaves.push({ view: Object.assign(new MarkdownView({} as WorkspaceLeaf), { file: f.note, editor: { getValue: () => text, replaceRange: writes } }) } as unknown as WorkspaceLeaf);
        }
        const result = await f.workflow.uploadPlan(plan, hosting, { replaceReferences: true });
        expect(writes).not.toHaveBeenCalled();
        expect(result.failures).toHaveLength(1);
        expect(result.outsideScopeNotes).toBe(1);
    });
    it('skips remote, missing and ambiguous references without uploading an arbitrary same-name image', async () => {
        const f = fixture();
        f.contents.set(f.note.path, '![[photo.png]]\n![remote](https://cdn/photo.png)\n![[missing.png]]');
        const plan = await createUploadPlan(f.app, f.converter, { kind: 'note', path: f.note.path }, ['png']);
        expect(plan.sources).toEqual([]);
        expect(plan.skipped.map(item => item.reason)).toEqual(['ambiguous', 'missing']);
        await f.workflow.uploadPlan(plan, hosting, { replaceReferences: true });
        expect(f.uploadFile).not.toHaveBeenCalled();
        expect(f.process).not.toHaveBeenCalled();
    });
    it('cancels a source moved after planning and never associates it by basename', async () => {
        const f = fixture();
        const plan = await createUploadPlan(f.app, f.converter, { kind: 'note', path: f.note.path }, ['png']);
        f.image.path = 'moved/photo.png';
        const result = await f.workflow.uploadPlan(plan, hosting, { replaceReferences: true });
        expect(result.failedImages).toBe(1);
        expect(f.uploadFile).not.toHaveBeenCalled();
        expect(f.process).not.toHaveBeenCalled();
    });
    it('rejects overlapping explicit uploads and releases the guard after completion', async () => {
        const f = fixture();
        let release!: () => void;
        const gate = new Promise<void>(resolve => { release = resolve; });
        f.uploadFile.mockImplementation(async image => {
            await gate;
            return { success: true, url: 'https://cdn/photo.png', originalPath: image.name, attempts: 1, hostingId: 'h', hostingType: 'custom' };
        });
        const plan = await createUploadPlan(f.app, f.converter, { kind: 'note', path: f.note.path }, ['png']);
        const first = f.workflow.uploadPlan(plan, hosting, { replaceReferences: false });
        await expect(f.workflow.uploadPlan(plan, hosting, { replaceReferences: true })).rejects.toThrow('already running');
        release(); await first;
        expect(f.workflow.isBusy).toBe(false);
    });
    it('preserves the single-image entry point and reference renderer', async () => {
        const f = fixture();
        const result = await f.workflow.uploadImage(f.image, hosting, true);
        expect(result.reference).toBe('![photo](https://cdn/assets/photo.png)');
        expect(result.replacedReferences).toBe(3);
    });
});
