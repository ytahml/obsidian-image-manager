import { beforeEach, describe, expect, it, vi } from 'vitest';

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
    class Setting {}
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
    shouldDisableKeepLocalCopy,
} from '../src/settings';
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

    it('binds paste toggles to the active mode and derives the keep-local gate', () => {
        const { plugin } = createTab('managed');
        plugin.settings.managedAutoUploadOnPaste = true;
        plugin.settings.managedKeepLocalCopy = false;
        plugin.settings.delegatedAutoUploadOnPaste = false;
        plugin.settings.delegatedKeepLocalCopy = false;

        expect(getActivePastePreference(plugin.settings, 'autoUploadOnPaste')).toBe(true);
        expect(getActivePastePreference(plugin.settings, 'keepLocalCopy')).toBe(false);
        expect(shouldDisableKeepLocalCopy(plugin.settings)).toBe(false);
        setActivePastePreference(plugin.settings, 'autoUploadOnPaste', false);
        expect(plugin.settings.managedAutoUploadOnPaste).toBe(false);
        expect(plugin.settings.delegatedAutoUploadOnPaste).toBe(false);

        plugin.settings.localManagementMode = 'delegated';
        expect(getActivePastePreference(plugin.settings, 'keepLocalCopy')).toBe(false);
        expect(shouldDisableKeepLocalCopy(plugin.settings)).toBe(true);
        setActivePastePreference(plugin.settings, 'autoUploadOnPaste', true);
        expect(plugin.settings.delegatedAutoUploadOnPaste).toBe(true);
        expect(plugin.settings.managedAutoUploadOnPaste).toBe(false);
        expect(shouldDisableKeepLocalCopy(plugin.settings)).toBe(false);
        setActivePastePreference(plugin.settings, 'keepLocalCopy', true);
        expect(plugin.settings.delegatedKeepLocalCopy).toBe(true);
        expect(plugin.settings.managedKeepLocalCopy).toBe(false);
    });
});
