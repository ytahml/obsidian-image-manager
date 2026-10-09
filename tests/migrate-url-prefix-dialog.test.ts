import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const ui = vi.hoisted(() => ({
    buttons: [] as Array<{ text: string; disabled: boolean; click: () => void }>,
    texts: [] as Array<{ value: string; change: (value: string) => void }>,
    dropdowns: [] as Array<{ value: string; change: (value: string) => void }>,
}));
vi.mock('obsidian', () => {
    const root = { empty() {}, createEl: () => ({ setText() {} }) };
    return {
        Modal: class { contentEl = root; modalEl = { addClass() {} }; constructor(public app: unknown) {} open() {} close() {} },
        FuzzySuggestModal: class {}, Notice: vi.fn(), TFile: class {}, TFolder: class {},
        Setting: class {
            setName() { return this; } setHeading() { return this; } setDesc() { return this; }
            addText(callback: (value: unknown) => void) {
                const value = { value: '', inputEl: { classList: { add() {} } }, change: (_: string) => {}, setPlaceholder() { return this; }, setValue(next: string) { this.value = next; return this; }, onChange(fn: (v: string) => void) { this.change = fn; return this; } };
                ui.texts.push(value); callback(value); return this;
            }
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
import type { UrlPrefixMigrationPlan } from '../src/remote/url-prefix-migration';
import { MigrateUrlPrefixDialog } from '../src/modals/migrate-url-prefix-dialog';

const plan: UrlPrefixMigrationPlan = {
    fromBase: 'https://old.example.com',
    toBase: 'https://new.example.com',
    totalNotes: 2,
    notePaths: ['a.md', 'b.md'],
    referenceCount: 2,
};
beforeEach(() => {
    vi.clearAllMocks();
    ui.buttons.length = 0; ui.texts.length = 0; ui.dropdowns.length = 0;
    vi.useFakeTimers();
    vi.stubGlobal('window', { setTimeout, clearTimeout });
});

afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
});

it('prefills hosting editor values, previews automatically, and executes once', async () => {
    const preview = vi.fn(async () => plan);
    const execute = vi.fn(async () => {});
    const dialog = new MigrateUrlPrefixDialog({} as App, { preview, execute }, { fromBase: 'https://old.example.com', toBase: 'https://new.example.com' });
    dialog.onOpen();
    const start = ui.buttons[1]!;
    expect(start.disabled).toBe(true);
    await Promise.resolve();
    expect(preview).toHaveBeenCalledWith({ kind: 'vault' }, 'https://old.example.com', 'https://new.example.com');
    expect(start.disabled).toBe(false);
    start.click(); start.click();
    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledWith(plan);
});

it('keeps the start button disabled when nothing matches', async () => {
    const empty = { ...plan, notePaths: [], referenceCount: 0 };
    const dialog = new MigrateUrlPrefixDialog({} as App, { preview: async () => empty, execute: vi.fn() }, { fromBase: 'https://old.example.com', toBase: 'https://new.example.com' });
    dialog.onOpen();
    await Promise.resolve();
    expect(ui.buttons[1]!.disabled).toBe(true);
});

it('does not preview identical bases', async () => {
    const preview = vi.fn(async () => plan);
    const dialog = new MigrateUrlPrefixDialog({} as App, { preview, execute: vi.fn() }, { fromBase: 'https://old.example.com', toBase: 'https://old.example.com' });
    dialog.onOpen();
    await Promise.resolve();
    expect(preview).not.toHaveBeenCalled();
    expect(ui.buttons[1]!.disabled).toBe(true);
});

it('disables submit and drops the plan immediately when the input changes', async () => {
    const preview = vi.fn(async () => plan);
    const execute = vi.fn(async () => {});
    const dialog = new MigrateUrlPrefixDialog({} as App, { preview, execute }, { fromBase: 'https://old.example.com', toBase: 'https://new.example.com' });
    dialog.onOpen();
    await Promise.resolve();
    expect(ui.buttons[1]!.disabled).toBe(false);

    ui.texts[1]!.change('https://other.example.com');
    expect(ui.buttons[1]!.disabled).toBe(true);
    ui.buttons[1]!.click();
    expect(execute).not.toHaveBeenCalled();
});

it('ignores a stale preview that resolves after a newer one', async () => {
    let resolveOld!: (p: UrlPrefixMigrationPlan) => void;
    let resolveNew!: (p: UrlPrefixMigrationPlan) => void;
    const preview = vi.fn()
        .mockImplementationOnce(() => new Promise<UrlPrefixMigrationPlan>(res => { resolveOld = res; }))
        .mockImplementationOnce(() => new Promise<UrlPrefixMigrationPlan>(res => { resolveNew = res; }));
    const execute = vi.fn(async () => {});

    const dialog = new MigrateUrlPrefixDialog({} as App, { preview, execute }, { fromBase: 'https://old.example.com', toBase: 'https://new.example.com' });
    dialog.onOpen();
    await Promise.resolve();

    ui.texts[1]!.change('https://other.example.com');
    vi.advanceTimersByTime(300);
    await Promise.resolve();

    resolveNew({ ...plan, toBase: 'https://other.example.com' });
    await Promise.resolve();
    expect(ui.buttons[1]!.disabled).toBe(false);

    resolveOld({ ...plan, toBase: 'https://new.example.com' });
    await Promise.resolve();

    ui.buttons[1]!.click();
    expect(execute).toHaveBeenCalledWith(expect.objectContaining({ toBase: 'https://other.example.com' }));
});
