import { describe, expect, it } from 'vitest';
import { normalizeImageManagerSettings } from '../src/types';

describe('settings migration', () => {
    it('preserves a legacy effective disabled auto-upload state', () => {
        const settings = normalizeImageManagerSettings({
            autoUploadOnPaste: true,
            reorganizeConvertFormat: false,
            autoCompress: true,
            hostingConfigs: [{ id: 'hosting', enabled: true }] as never,
        });

        expect(settings.localManagementMode).toBe('managed');
        expect(settings.managedPasteReferenceFormat).toBe('wiki');
        expect(settings.managedAutoUploadOnPaste).toBe(false);
        expect(settings.delegatedAutoUploadOnPaste).toBe(false);
        expect(settings.compressManagedPasteLocal).toBe(true);
        expect(settings.compressBeforeUpload).toBe(true);
    });

    it('does not enable automatic upload without a resolvable hosting target', () => {
        const settings = normalizeImageManagerSettings({
            autoUploadOnPaste: true,
            reorganizeConvertFormat: true,
            hostingConfigs: [],
        });

        expect(settings.managedAutoUploadOnPaste).toBe(false);
        expect(settings.delegatedAutoUploadOnPaste).toBe(false);
    });

    it('keeps explicit delegated and split compression settings', () => {
        const settings = normalizeImageManagerSettings({
            localManagementMode: 'delegated',
            managedPasteReferenceFormat: 'markdown',
            compressManagedPasteLocal: false,
            compressBeforeUpload: true,
            hostingConfigs: [{ id: 'hosting', enabled: true }] as never,
        });

        expect(settings.localManagementMode).toBe('delegated');
        expect(settings.compressManagedPasteLocal).toBe(false);
        expect(settings.compressBeforeUpload).toBe(true);
    });

    it('does not let a legacy format value gate a migrated automatic upload setting', () => {
        const settings = normalizeImageManagerSettings({
            localManagementMode: 'delegated',
            autoUploadOnPaste: true,
            reorganizeConvertFormat: false,
            hostingConfigs: [{ id: 'hosting', enabled: true }] as never,
        });

        expect(settings.managedAutoUploadOnPaste).toBe(true);
        expect(settings.delegatedAutoUploadOnPaste).toBe(true);
    });

    it('preserves independent managed and delegated paste preferences', () => {
        const settings = normalizeImageManagerSettings({
            managedAutoUploadOnPaste: false,
            delegatedAutoUploadOnPaste: true,
            managedKeepLocalCopy: true,
            delegatedKeepLocalCopy: false,
        });

        expect(settings.managedAutoUploadOnPaste).toBe(false);
        expect(settings.delegatedAutoUploadOnPaste).toBe(true);
        expect(settings.managedKeepLocalCopy).toBe(true);
        expect(settings.delegatedKeepLocalCopy).toBe(false);
    });

    it('copies the legacy keep-local preference to both modes and removes legacy keys', () => {
        const settings = normalizeImageManagerSettings({
            localManagementMode: 'delegated',
            autoUploadOnPaste: false,
            keepLocalCopy: true,
        });

        expect(settings.managedKeepLocalCopy).toBe(true);
        expect(settings.delegatedKeepLocalCopy).toBe(true);
        expect(settings.autoUploadOnPaste).toBeUndefined();
        expect(settings.keepLocalCopy).toBeUndefined();
    });
});
