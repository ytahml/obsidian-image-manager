import { beforeEach, describe, expect, it, vi } from 'vitest';

const renderedToggles = vi.hoisted(() => new Map<string, { disabled: boolean; change: (value: boolean) => Promise<void> }>());
vi.mock('obsidian', () => {
    class PluginSettingTab {
        app: unknown;
        plugin: { settings: Record<string, unknown>; saveData: (data: unknown) => Promise<void> };
        update = vi.fn();

        constructor(app: unknown, plugin: { settings: Record<string, unknown>; saveData: (data: unknown) => Promise<void> }) {
            this.app = app;
            this.plugin = plugin;
        }

        async setControlValue(key: string, value: unknown): Promise<void> {
            this.plugin.settings[key] = value;
            await this.plugin.saveData(this.plugin.settings);
        }
    }

    class Modal {}
    const root = { empty() {}, addClass() {}, removeClass() {}, textContent: '', createDiv() { return this; } };
    class Setting {
        settingEl = root;
        descEl = root;
        name = '';
        setName(value: string) { this.name = value; return this; }
        setDesc() { return this; }
        setHeading() { return this; }
        addText() { return this; }
        addButton() { return this; }
        addToggle(callback: (toggle: unknown) => void) {
            const toggle = {
                disabled: false, change: async (_value: boolean) => {},
                setDisabled(value: boolean) { this.disabled = value; return this; },
                setValue() { return this; },
                onChange(fn: (value: boolean) => Promise<void>) { this.change = fn; return this; },
            };
            callback(toggle);
            renderedToggles.set(this.name, toggle);
            return this;
        }
    }
    class DropdownComponent {}
    class TextComponent {}

    return {
        App: class App {},
        DropdownComponent,
        Modal,
        PluginSettingTab,
        Setting,
        TextComponent,
        requestUrl: vi.fn(),
    };
});

import {
    getActivePastePreference,
    ImageManagerSettingTab,
    setActivePastePreference,
} from '../src/settings';
import { Setting, type SettingGroup } from 'obsidian';
import { setLocale, t } from '../src/i18n';
import { DEFAULT_SETTINGS, type ImageManagerSettings } from '../src/types';

interface FakePlugin {
    settings: ImageManagerSettings;
    saveData: ReturnType<typeof vi.fn>;
    saveSettings: ReturnType<typeof vi.fn>;
    cancelDelegatedTransactions: ReturnType<typeof vi.fn>;
}

function createTab(mode: 'managed' | 'delegated' = 'managed') {
    const plugin: FakePlugin = {
        settings: { ...DEFAULT_SETTINGS, hostingConfigs: [], localManagementMode: mode },
        saveData: vi.fn(async () => undefined),
        saveSettings: vi.fn(async () => undefined),
        cancelDelegatedTransactions: vi.fn(),
    };
    const tab = new ImageManagerSettingTab({} as never, plugin as never);
    return { plugin, tab };
}

function findControl(tab: ImageManagerSettingTab, key: string) {
    for (const item of tab.getSettingDefinitions()) {
        if ('control' in item && item.control?.key === key) return item.control;
        if ('items' in item && item.items) {
            for (const child of item.items) {
                if ('control' in child && child.control?.key === key) return child.control;
            }
        }
    }
    throw new Error(`Missing control: ${key}`);
}

function hasControl(tab: ImageManagerSettingTab, key: string): boolean {
    try {
        findControl(tab, key);
        return true;
    } catch {
        return false;
    }
}

function hasSetting(tab: ImageManagerSettingTab, name: string): boolean {
    return tab.getSettingDefinitions().some((item) => {
        if ('name' in item && item.name === name) return true;
        return 'items' in item && item.items?.some((child) => 'name' in child && child.name === name);
    });
}

describe('Obsidian 1.13 declarative settings', () => {
    beforeEach(() => setLocale('en'));

    it('uses declarative controls for ordinary persisted fields', () => {
        const { tab } = createTab();

        expect(findControl(tab, 'locale').type).toBe('dropdown');
        expect(findControl(tab, 'imagePathTemplate').type).toBe('text');
        expect(findControl(tab, 'compressQuality').type).toBe('slider');
        expect(findControl(tab, 'enableImageBrowser').type).toBe('toggle');
    });

    it('hides managed-only controls but keeps shared path controls in delegated mode', () => {
        const { tab } = createTab('delegated');
        const managedOnlyKeys = [
            'managedPasteReferenceFormat',
            'imageNamingTemplate',
            'promptImageName',
            'compressManagedPasteLocal',
        ];

        for (const key of managedOnlyKeys) {
            expect(hasControl(tab, key)).toBe(false);
        }
        expect(hasControl(tab, 'imagePathTemplate')).toBe(true);
        expect(hasControl(tab, 'imagePathBase')).toBe(true);
        expect(hasSetting(tab, t('settings.delegatedCompatibility'))).toBe(true);
    });

    it('shows the delegated compatibility notice only on the delegated line', () => {
        expect(hasSetting(createTab('managed').tab, t('settings.delegatedCompatibility'))).toBe(false);
        expect(hasSetting(createTab('delegated').tab, t('settings.delegatedCompatibility'))).toBe(true);
    });

    it('persists normalized values and refreshes settings with side effects', async () => {
        const { plugin, tab } = createTab();
        const update = vi.spyOn(tab, 'update');

        await tab.setControlValue('imagePathTemplate', '');
        expect(plugin.settings.imagePathTemplate).toBe(DEFAULT_SETTINGS.imagePathTemplate);

        await tab.setControlValue('localManagementMode', 'delegated');
        expect(plugin.cancelDelegatedTransactions).toHaveBeenCalledOnce();

        await tab.setControlValue('locale', 'zh');
        expect(t('settings.language')).toBe('语言');
        expect(plugin.saveData).toHaveBeenCalledTimes(3);
        expect(update).toHaveBeenCalledTimes(2);
    });

    it.each(['managed', 'delegated'] as const)('keeps %s local-copy control enabled with paste auto-upload off', async mode => {
        const { plugin, tab } = createTab(mode);
        plugin.settings.managedAutoUploadOnPaste = false;
        plugin.settings.delegatedAutoUploadOnPaste = false;
        const hosting = tab.getSettingDefinitions().find(item => 'name' in item && item.name === t('settings.imageHosting'));
        if (!hosting || !('render' in hosting) || !hosting.render) throw new Error('Missing hosting settings');
        hosting.render(new Setting({} as HTMLElement), {} as SettingGroup);
        const toggle = renderedToggles.get(t('settings.keepLocalCopy'))!;
        expect(toggle.disabled).toBe(false);
        await toggle.change(true);
        expect(mode === 'managed' ? plugin.settings.managedKeepLocalCopy : plugin.settings.delegatedKeepLocalCopy).toBe(true);
        expect(mode === 'managed' ? plugin.settings.delegatedKeepLocalCopy : plugin.settings.managedKeepLocalCopy).toBe(false);
        expect(plugin.saveSettings).toHaveBeenCalledOnce();
    });

    it('preserves independent paste preferences when switching modes', async () => {
        const { plugin, tab } = createTab('managed');
        plugin.settings.managedAutoUploadOnPaste = false;
        plugin.settings.managedKeepLocalCopy = true;
        plugin.settings.delegatedAutoUploadOnPaste = true;
        plugin.settings.delegatedKeepLocalCopy = false;

        await tab.setControlValue('localManagementMode', 'delegated');
        await tab.setControlValue('localManagementMode', 'managed');

        expect(plugin.settings.managedAutoUploadOnPaste).toBe(false);
        expect(plugin.settings.managedKeepLocalCopy).toBe(true);
        expect(plugin.settings.delegatedAutoUploadOnPaste).toBe(true);
        expect(plugin.settings.delegatedKeepLocalCopy).toBe(false);
    });

    it('binds upload preferences to the active mode independently of auto-upload', () => {
        const { plugin } = createTab('managed');
        plugin.settings.managedAutoUploadOnPaste = true;
        plugin.settings.managedKeepLocalCopy = false;
        plugin.settings.delegatedAutoUploadOnPaste = false;
        plugin.settings.delegatedKeepLocalCopy = false;

        expect(getActivePastePreference(plugin.settings, 'autoUploadOnPaste')).toBe(true);
        expect(getActivePastePreference(plugin.settings, 'keepLocalCopy')).toBe(false);
        setActivePastePreference(plugin.settings, 'autoUploadOnPaste', false);
        expect(plugin.settings.managedAutoUploadOnPaste).toBe(false);
        expect(plugin.settings.delegatedAutoUploadOnPaste).toBe(false);

        plugin.settings.localManagementMode = 'delegated';
        expect(getActivePastePreference(plugin.settings, 'keepLocalCopy')).toBe(false);
        setActivePastePreference(plugin.settings, 'autoUploadOnPaste', true);
        expect(plugin.settings.delegatedAutoUploadOnPaste).toBe(true);
        expect(plugin.settings.managedAutoUploadOnPaste).toBe(false);
        setActivePastePreference(plugin.settings, 'keepLocalCopy', true);
        expect(plugin.settings.delegatedKeepLocalCopy).toBe(true);
        expect(plugin.settings.managedKeepLocalCopy).toBe(false);
    });
});
