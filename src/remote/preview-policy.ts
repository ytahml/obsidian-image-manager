import type { ImageHostingConfig } from '../types';
import { getRemoteManagementConfig } from './management-settings';
import type { RemoteObjectProvider } from './provider';
import type { RemoteObject } from './types';

export type RemotePreviewUnavailableReason =
    | 'unsupported'
    | 'public-url-required'
    | 'archived'
    | 'not-image';

const ARCHIVE_STORAGE_CLASSES = new Set(['GLACIER', 'DEEP_ARCHIVE']);

/** Decide whether an object can be manually previewed without making a request. */
export function getRemotePreviewUnavailableReason(
    config: ImageHostingConfig,
    provider: RemoteObjectProvider | undefined,
    object: RemoteObject,
    supportedExtensions: readonly string[]
): RemotePreviewUnavailableReason | undefined {
    if (!provider?.capabilities.has('preview') || !provider.createPreviewUrl) {
        return 'unsupported';
    }
    const settings = getRemoteManagementConfig(config);
    if (settings.previewAccess === 'public' && !config.urlPrefix.trim()) {
        return 'public-url-required';
    }
    if (object.storageClass && ARCHIVE_STORAGE_CLASSES.has(object.storageClass.toUpperCase())) {
        return 'archived';
    }
    const extension = object.key.split('/').pop()?.split('.').pop()?.toLowerCase() ?? '';
    if (!supportedExtensions.some((item) => item.toLowerCase() === extension)) {
        return 'not-image';
    }
    return undefined;
}
