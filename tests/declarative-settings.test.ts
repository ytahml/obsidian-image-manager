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

import { ImageManagerSettingTab } from '../src/settings';
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

describe('Obsidian 1.13 declarative settings', () => {
    beforeEach(() => setLocale('en'));

    it('uses declarative controls for ordinary persisted fields', () => {
        const { tab } = createTab();

        expect(findControl(tab, 'locale').type).toBe('dropdown');
        expect(findControl(tab, 'imagePathTemplate').type).toBe('text');
        expect(findControl(tab, 'compressQuality').type).toBe('slider');
        expect(findControl(tab, 'enableImageBrowser').type).toBe('toggle');
    });

    it('disables managed-only controls in delegated mode', () => {
        const { tab } = createTab('delegated');
        const managedOnlyKeys = [
            'imagePathTemplate',
            'imagePathBase',
            'managedPasteReferenceFormat',
            'imageNamingTemplate',
            'promptImageName',
            'compressManagedPasteLocal',
        ];

        for (const key of managedOnlyKeys) {
            const disabled = findControl(tab, key).disabled;
            expect(typeof disabled === 'function' ? disabled() : disabled).toBe(true);
        }
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
});
