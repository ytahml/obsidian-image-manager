import { beforeEach, expect, it, vi } from 'vitest';
const ui = vi.hoisted(() => ({
    buttons: [] as Array<{ text: string; disabled: boolean; click: () => void }>,
    dropdowns: [] as Array<{ value: string; change: (value: string) => void }>,
}));
vi.mock('obsidian', () => {
    const root = { empty() {}, createEl: () => ({}) };
    return {
        Modal: class { contentEl = root; constructor(public app: unknown) {} open() {} close() {} },
        FuzzySuggestModal: class {}, Notice: class {}, TFile: class {}, TFolder: class {},
        Setting: class {
            setName() { return this; } setHeading() { return this; } setDesc() { return this; }
            addDropdown(callback: (value: unknown) => void) {
                const value = { value: '', change: (_: string) => {}, addOption() { return this; }, setValue(next: string) { this.value = next; return this; }, onChange(fn: (v: string) => void) { this.change = fn; return this; } };
                ui.dropdowns.push(value); callback(value); return this;
            }
            addButton(callback: (value: unknown) => void) {
                const value = { text: '', disabled: false, click: () => {}, setButtonText(text: string) { this.text = text; return this; }, setCta() { return this; }, setDisabled(next: boolean) { this.disabled = next; return this; }, onClick(fn: () => void) { this.click = fn; return this; } };
                ui.buttons.push(value); callback(value); return this;
            }
        },
    };
});
import type { App } from 'obsidian';
import { ConvertReferenceDialog } from '../src/modals/convert-reference-dialog';

beforeEach(() => { ui.buttons.length = 0; ui.dropdowns.length = 0; });

it('defaults to the vault and executes only once after confirmation', () => {
    const execute = vi.fn(() => new Promise<void>(() => {}));
    const app = { workspace: { getActiveFile: () => null } } as unknown as App;
    const dialog = new ConvertReferenceDialog(app, { kind: 'vault' }, { execute });
    dialog.onOpen();
    expect(ui.dropdowns[0]!.value).toBe('vault');
    const start = ui.buttons[ui.buttons.length - 1]!;
    expect(start.disabled).toBe(false);
    start.click(); start.click();
    expect(execute).toHaveBeenCalledOnce();
    expect(execute).toHaveBeenCalledWith({ kind: 'vault' });
});

it('does not execute on cancel and disables an empty note target', () => {
    const execute = vi.fn(async () => {});
    const app = { workspace: { getActiveFile: () => null } } as unknown as App;
    const dialog = new ConvertReferenceDialog(app, { kind: 'vault' }, { execute });
    dialog.onOpen();
    ui.buttons[0]!.click();
    expect(execute).not.toHaveBeenCalled();
    ui.dropdowns[0]!.change('note');
    expect(ui.buttons[ui.buttons.length - 1]!.disabled).toBe(true);
    ui.buttons[ui.buttons.length - 1]!.click();
    expect(execute).not.toHaveBeenCalled();
});
