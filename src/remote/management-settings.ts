import type { ImageHostingConfig, RemoteManagementConfig } from '../types';

export const DEFAULT_REMOTE_MANAGEMENT_CONFIG: Readonly<RemoteManagementConfig> = {
    enabled: false,
    prefix: '',
    pageSize: 100,
    previewMode: 'manual',
    previewAccess: 'presigned',
    deleteEnabled: false,
    publicUrlAliases: [],
};

/** Return a normalized copy without changing persisted legacy settings. */
export function getRemoteManagementConfig(config: ImageHostingConfig): RemoteManagementConfig {
    const value = config.remoteManagement;
    return {
        enabled: value?.enabled ?? DEFAULT_REMOTE_MANAGEMENT_CONFIG.enabled,
        prefix: normalizeRemotePrefix(value?.prefix ?? DEFAULT_REMOTE_MANAGEMENT_CONFIG.prefix),
        pageSize: normalizeRemotePageSize(value?.pageSize),
        previewMode: value?.previewMode === 'viewport' ? 'viewport' : 'manual',
        previewAccess: value?.previewAccess === 'public' ? 'public' : 'presigned',
        deleteEnabled: value?.deleteEnabled ?? DEFAULT_REMOTE_MANAGEMENT_CONFIG.deleteEnabled,
        publicUrlAliases: normalizePublicUrlAliases(value?.publicUrlAliases ?? []),
    };
}

export function normalizeRemotePrefix(value: string): string {
    return value.trim().replace(/^\/+|\/+$/g, '');
}

export function normalizeRemotePageSize(value: number | undefined): number {
    if (!Number.isFinite(value)) return DEFAULT_REMOTE_MANAGEMENT_CONFIG.pageSize;
    return Math.min(1000, Math.max(1, Math.floor(value!)));
}

export function normalizePublicUrlAliases(values: readonly string[]): string[] {
    return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}
