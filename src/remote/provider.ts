import type {
    RemoteCapability,
    RemoteDeleteResult,
    RemoteFolderListPage,
    RemoteFolderListRequest,
    RemoteListPage,
    RemoteListRequest,
    RemoteObject,
    RemotePreviewUrl,
    RemoteUrlMapping,
} from './types';

/** Provider boundary for remote list, preview, and delete operations. */
export interface RemoteObjectProvider {
    readonly capabilities: ReadonlySet<RemoteCapability>;
    readonly referenceMapping?: RemoteUrlMapping;
    listObjects(request: RemoteListRequest): Promise<RemoteListPage>;
    listFolders?: (request: RemoteFolderListRequest) => Promise<RemoteFolderListPage>;
    createPreviewUrl?: (object: RemoteObject) => Promise<RemotePreviewUrl>;
    deleteObject?: (object: RemoteObject) => Promise<RemoteDeleteResult>;
}

/**
 * Request one page while deliberately preserving the provider-owned cursor.
 * Future UI and session code should use this boundary instead of transforming
 * pagination tokens in shared code.
 */
export function listRemoteObjects(
    provider: RemoteObjectProvider,
    request: RemoteListRequest
): Promise<RemoteListPage> {
    return provider.listObjects(request);
}
