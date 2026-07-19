import type { ImageHostingConfig, RemoteManagementConfig } from '../types';

export const DEFAULT_REMOTE_MANAGEMENT_CONFIG: Readonly<RemoteManagementConfig> = {
    enabled: false,
    prefix: '',
    pageSize: 100,
    previewMode: 'viewport',
    previewAccess: 'presigned',
    publicUrlAliases: [],
};

/** Return a normalized copy without changing persisted legacy settings. */
export function getRemoteManagementConfig(config: ImageHostingConfig): RemoteManagementConfig {
    const value = config.remoteManagement;
    return {
        enabled: value?.enabled ?? DEFAULT_REMOTE_MANAGEMENT_CONFIG.enabled,
        prefix: normalizeRemotePrefix(value?.prefix ?? DEFAULT_REMOTE_MANAGEMENT_CONFIG.prefix),
        pageSize: normalizeRemotePageSize(value?.pageSize),
        // Remote management now always uses viewport thumbnails after an explicit scan.
        previewMode: 'viewport',
        previewAccess: value?.previewAccess === 'public' ? 'public' : 'presigned',
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

/** Validate a reference URL base using the same optional-https convention as urlPrefix. */
export function isValidPublicUrlAlias(value: string): boolean {
    const trimmed = value.trim();
    if (!trimmed) return false;
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) && !/^https?:\/\//i.test(trimmed)) return false;
    const candidate = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    try {
        const url = new URL(candidate);
        return (url.protocol === 'http:' || url.protocol === 'https:') &&
            Boolean(url.hostname) &&
            !url.username &&
            !url.password &&
            !url.search &&
            !url.hash;
    } catch {
        return false;
    }
}
