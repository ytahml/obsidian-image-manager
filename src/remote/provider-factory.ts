import type { HostingType, ImageHostingConfig } from '../types';
import type { RemoteCapability } from './types';
import type { RemoteObjectProvider } from './provider';
import { AliyunOSSRemoteObjectProvider } from './providers/aliyun-oss-remote';
import { S3RemoteObjectProvider } from './providers/s3-compatible-remote';
import { QiniuRemoteObjectProvider } from './providers/qiniu-remote';

export type RemoteProviderUnsupportedReason =
    | 'not-implemented'
    | 'unknown-provider';

export type RemoteProviderFactoryResult =
    | {
        status: 'ready';
        provider: RemoteObjectProvider;
    }
    | {
        status: 'unsupported';
        hostingId: string;
        hostingType: HostingType;
        capabilities: ReadonlySet<RemoteCapability>;
        reason: RemoteProviderUnsupportedReason;
    };

export type RemoteProviderBuilder = (
    config: ImageHostingConfig
) => RemoteObjectProvider;

export type RemoteProviderRegistry = Partial<Record<HostingType, RemoteProviderBuilder>>;

export const DEFAULT_REMOTE_PROVIDER_REGISTRY: RemoteProviderRegistry = {
    'aliyun-oss': (config) => new AliyunOSSRemoteObjectProvider(config),
    s3: (config) => new S3RemoteObjectProvider(config),
    qiniu: (config) => new QiniuRemoteObjectProvider(config),
};

const NO_CAPABILITIES: ReadonlySet<RemoteCapability> = new Set<RemoteCapability>();
const KNOWN_HOSTING_TYPES: ReadonlySet<string> = new Set<HostingType>([
    'aliyun-oss',
    'qiniu',
    's3',
    'custom',
]);

/**
 * Create a remote provider without affecting the existing uploader factory.
 * Missing implementations are returned as data so callers can render an
 * unavailable state without relying on exceptions.
 */
export function createRemoteObjectProvider(
    config: ImageHostingConfig,
    registry: RemoteProviderRegistry = DEFAULT_REMOTE_PROVIDER_REGISTRY
): RemoteProviderFactoryResult {
    const builder = registry[config.type];
    if (builder) {
        return {
            status: 'ready',
            provider: builder(config),
        };
    }

    return {
        status: 'unsupported',
        hostingId: config.id,
        hostingType: config.type,
        capabilities: NO_CAPABILITIES,
        reason: KNOWN_HOSTING_TYPES.has(config.type) ? 'not-implemented' : 'unknown-provider',
    };
}

/** Whether this hosting config currently has a production remote-list provider. */
export function supportsRemoteObjectManagement(
    config: ImageHostingConfig,
    registry: RemoteProviderRegistry = DEFAULT_REMOTE_PROVIDER_REGISTRY
): boolean {
    const result = createRemoteObjectProvider(config, registry);
    return result.status === 'ready' && result.provider.capabilities.has('list');
}
