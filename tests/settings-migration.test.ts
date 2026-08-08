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
        expect(settings.autoUploadOnPaste).toBe(false);
        expect(settings.compressManagedPasteLocal).toBe(true);
        expect(settings.compressBeforeUpload).toBe(true);
    });

    it('does not enable automatic upload without a resolvable hosting target', () => {
        const settings = normalizeImageManagerSettings({
            autoUploadOnPaste: true,
            reorganizeConvertFormat: true,
            hostingConfigs: [],
        });

        expect(settings.autoUploadOnPaste).toBe(false);
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
});
