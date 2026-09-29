import { beforeEach, expect, it, vi } from 'vitest';
const ui = vi.hoisted(() => ({ buttons: [] as Array<{ text: string; disabled: boolean; click: () => void }>, toggles: [] as Array<{ value: boolean; change: (value: boolean) => void }>, dropdowns: [] as Array<{ change: (value: string) => void }> }));
vi.mock('obsidian', () => {
    const root = { empty() {}, createEl: () => ({ setText() {} }) };
    return {
        Modal: class { contentEl = root; constructor(public app: unknown) {} open() {} close() {} },
        FuzzySuggestModal: class {}, Notice: class {}, TFile: class {}, TFolder: class {},
        Setting: class {
            setName() { return this; } setHeading() { return this; } setDesc() { return this; }
            addDropdown(callback: (value: unknown) => void) {
                const value = { change: (_: string) => {}, addOption() { return this; }, setValue() { return this; }, onChange(fn: (v: string) => void) { this.change = fn; return this; } };
                ui.dropdowns.push(value); callback(value); return this;
            }
            addToggle(callback: (value: unknown) => void) {
                const value = { value: false, change: (_: boolean) => {}, setValue(v: boolean) { this.value = v; return this; }, onChange(fn: (v: boolean) => void) { this.change = fn; return this; } };
                ui.toggles.push(value); callback(value); return this;
            }
            addButton(callback: (value: unknown) => void) {
                const value = { text: '', disabled: false, click: () => {}, setButtonText(text: string) { this.text = text; return this; }, setCta() { return this; }, setDisabled(v: boolean) { this.disabled = v; return this; }, onClick(fn: () => void) { this.click = fn; return this; } };
                ui.buttons.push(value); callback(value); return this;
            }
        },
    };
});
import type { App } from 'obsidian';
import type { ImageHostingConfig } from '../src/types';
import type { UploadPlan } from '../src/uploaders/upload-scope';
import { BatchUploadDialog } from '../src/modals/batch-upload-dialog';
const hosting = { id: 'h', enabled: true, name: 'Hosting' } as ImageHostingConfig;
const plan = { scope: { kind: 'vault' }, notes: [], sources: [{}], skipped: [] } as unknown as UploadPlan;
beforeEach(() => { ui.buttons.length = 0; ui.toggles.length = 0; ui.dropdowns.length = 0; });
it('does not execute while preparing and confirms only once with the chosen replacement option', async () => {
    const execute = vi.fn(() => new Promise<void>(() => {}));
    const dialog = new BatchUploadDialog({} as App, { kind: 'vault' }, false, { getHostings: () => [hosting], prepare: async () => plan, execute });
    dialog.onOpen();
    const start = ui.buttons[1]!;
    expect(start.disabled).toBe(true);
    expect(execute).not.toHaveBeenCalled();
    await Promise.resolve();
    expect(start.disabled).toBe(false);
    expect(ui.toggles[0]!.value).toBe(false);
    ui.toggles[0]!.change(true);
    start.click(); start.click();
    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledWith(plan, hosting, true);
});
it('closing a prepared dialog performs no upload', async () => {
    const execute = vi.fn();
    const dialog = new BatchUploadDialog({} as App, { kind: 'note', path: 'a.md' }, true, { getHostings: () => [hosting], prepare: async () => plan, execute });
    dialog.onOpen(); dialog.onClose();
    await Promise.resolve();
    expect(execute).not.toHaveBeenCalled();
    expect(ui.buttons[2]!.disabled).toBe(true);
});
it('keeps confirmation disabled without a hosting or candidates', async () => {
    const dialog = new BatchUploadDialog({} as App, { kind: 'vault' }, true, { getHostings: () => [], prepare: async () => plan, execute: vi.fn() });
    dialog.onOpen(); await Promise.resolve();
    expect(ui.buttons[1]!.disabled).toBe(true);
});
