import type { ImageHostingConfig, S3Config } from '../types';
import { getRemoteManagementConfig } from './management-settings';
import type { RemoteObjectProvider } from './provider';
import type {
    RemoteObject,
    RemoteReferenceIndexState,
    RemoteReferenceState,
} from './types';

export type RemoteDeleteUnavailableReason =
    | 'unsupported'
    | 'index-empty'
    | 'index-stale'
    | 'referenced'
    | 'possibly-referenced'
    | 'unmappable'
    | 'wrong-hosting'
    | 'outside-prefix'
    | 'not-in-scan';

export interface RemoteDeleteEligibilityContext {
    config: ImageHostingConfig;
    provider?: RemoteObjectProvider;
    indexState: RemoteReferenceIndexState;
    scannedObjects: readonly RemoteObject[];
    classify: (object: RemoteObject) => RemoteReferenceState;
}

export function getRemoteDeleteUnavailableReason(
    object: RemoteObject,
    context: RemoteDeleteEligibilityContext
): RemoteDeleteUnavailableReason | undefined {
    const settings = getRemoteManagementConfig(context.config);
    if (!settings.enabled) return 'unsupported';
    if (
        !context.provider?.capabilities.has('delete') ||
        typeof context.provider.deleteObject !== 'function'
    ) return 'unsupported';
    if (context.indexState.status === 'empty') return 'index-empty';
    if (context.indexState.status === 'stale') return 'index-stale';
    if (object.hostingId !== context.config.id) return 'wrong-hosting';
    if (!isKeyInRemotePrefix(object.key, settings.prefix)) return 'outside-prefix';
    if (!context.scannedObjects.some((candidate) =>
        candidate.hostingId === object.hostingId && candidate.key === object.key
    )) return 'not-in-scan';

    const state = context.classify(object);
    if (state === 'referenced') return 'referenced';
    if (state === 'possibly-referenced') return 'possibly-referenced';
    if (state === 'unmappable') return 'unmappable';
    return undefined;
}

export function isKeyInRemotePrefix(key: string, prefix: string): boolean {
    const normalized = prefix.replace(/^\/+|\/+$/g, '');
    return !normalized || key.startsWith(`${normalized}/`);
}

/** Non-secret fingerprint used to reject config drift before confirmation. */
export function getRemoteDeleteConfigFingerprint(config: ImageHostingConfig): string {
    const remote = getRemoteManagementConfig(config);
    const provider = config.type === 's3'
        ? config.config as S3Config
        : { bucket: (config.config as { bucket?: string }).bucket ?? '' };
    return JSON.stringify({
        id: config.id,
        type: config.type,
        endpoint: 'endpoint' in provider ? provider.endpoint.trim() : '',
        region: 'region' in provider ? provider.region.trim() : '',
        bucket: provider.bucket.trim(),
        forcePathStyle: 'forcePathStyle' in provider ? Boolean(provider.forcePathStyle) : false,
        prefix: remote.prefix,
        remoteManagementEnabled: remote.enabled,
    });
}
