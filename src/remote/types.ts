/** Capabilities that a remote object provider can expose independently. */
export type RemoteCapability = 'list' | 'preview' | 'delete';

/** Conservative reference states for objects managed outside the Vault. */
export type RemoteReferenceState =
    | 'referenced'
    | 'possibly-referenced'
    | 'not-referenced-in-current-vault'
    | 'unmappable';

/** Provider-independent metadata for one remote object. */
export interface RemoteObject {
    hostingId: string;
    key: string;
    size: number;
    lastModified?: number;
    etag?: string;
    mimeType?: string;
    storageClass?: string;
}

/**
 * Request for one remote object page.
 *
 * The cursor is owned by the provider. Shared code must pass it through without
 * parsing, decoding, or encoding it again.
 */
export interface RemoteListRequest {
    prefix: string;
    cursor?: string;
    limit: number;
    delimiter?: string;
}

/** One provider-normalized page of remote object metadata. */
export interface RemoteListPage {
    objects: RemoteObject[];
    nextCursor?: string;
    isTruncated: boolean;
}

/** Result of deleting one object, including provider-specific delete semantics. */
export interface RemoteDeleteResult {
    key: string;
    success: boolean;
    status?: number;
    error?: string;
    deletionKind?: 'permanent' | 'delete-marker' | 'unknown';
}
