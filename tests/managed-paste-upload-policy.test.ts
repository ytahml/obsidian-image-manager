import { describe, expect, it } from 'vitest';
import { chooseManagedPasteUploadSource } from '../src/lifecycle/managed-paste-upload-policy';

describe('managed paste upload policy', () => {
    it('reads the saved file only when upload compression still needs to be applied', () => {
        expect(chooseManagedPasteUploadSource({ localCompressed: false, uploadCompression: true })).toBe('saved-file');
        expect(chooseManagedPasteUploadSource({ localCompressed: true, uploadCompression: true })).toBe('prepared-data');
        expect(chooseManagedPasteUploadSource({ localCompressed: true, uploadCompression: false })).toBe('prepared-data');
        expect(chooseManagedPasteUploadSource({ localCompressed: false, uploadCompression: false })).toBe('prepared-data');
    });
});
