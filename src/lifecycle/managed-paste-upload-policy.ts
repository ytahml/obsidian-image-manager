export type ManagedPasteUploadSource = 'prepared-data' | 'saved-file';

export function chooseManagedPasteUploadSource(options: {
    localCompressed: boolean;
    uploadCompression: boolean;
}): ManagedPasteUploadSource {
    return options.uploadCompression && !options.localCompressed ? 'saved-file' : 'prepared-data';
}
