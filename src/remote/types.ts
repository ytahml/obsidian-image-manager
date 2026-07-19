/** Capabilities that a remote object provider can expose independently. */
export type RemoteCapability = 'list' | 'folders' | 'preview' | 'delete';

/** Explicit access contract for one manually requested remote preview. */
export type RemotePreviewAccess = 'presigned' | 'public';

/** Ephemeral URL returned for a remote preview request. */
export interface RemotePreviewUrl {
    url: string;
    access: RemotePreviewAccess;
    expiresAt?: number;
}

/** Conservative reference states for objects managed outside the Vault. */
export type RemoteReferenceState =
    | 'referenced'
    | 'possibly-referenced'
    | 'not-referenced-in-current-vault'
    | 'unmappable';

export interface RemoteReferenceLocation {
    path: string;
    line: number;
    syntax: 'markdown-image' | 'url';
}

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

/** Request for one level of provider-defined virtual folders. */
export interface RemoteFolderListRequest {
    prefix: string;
    cursor?: string;
    limit: number;
}

/** One page of full, normalized virtual-folder prefixes. */
export interface RemoteFolderListPage {
    prefixes: string[];
    nextCursor?: string;
    isTruncated: boolean;
}

export type RemoteDeleteFailureCode =
    | import('./errors').RemoteProviderErrorCode
    | 'conflict'
    | 'precondition'
    | 'locked';

/** Result of deleting one object, including provider-specific delete semantics. */
export interface RemoteDeleteResult {
    key: string;
    success: boolean;
    status?: number;
    deletionKind?: 'permanent' | 'delete-marker' | 'unknown';
    failureCode?: RemoteDeleteFailureCode;
    retryable?: boolean;
}

/** Redacted local diagnostic record for one completed remote delete request. Never a safety input. */
export interface RemoteDeleteAuditEntry {
    completedAt: number;
    hostingId: string;
    key: string;
    success: boolean;
    status?: number;
    deletionKind?: 'permanent' | 'delete-marker' | 'unknown';
    failureCode?: RemoteDeleteFailureCode;
}

/** Public URL bases that can resolve to object keys for one hosting config. */
export interface RemoteUrlMapping {
    hostingId: string;
    urlPrefix: string;
    publicUrlAliases: readonly string[];
    ignoredQueryParameters?: readonly string[];
}

/** Scope and counters for one completed Vault reference scan. */
export interface RemoteReferenceScanSummary {
    scannedAt: number;
    markdownFileCount: number;
    referencedCount: number;
    possiblyReferencedCount: number;
    unmappableCount: number;
}

/** Lifecycle state for the in-memory Vault reference index. */
export type RemoteReferenceIndexState =
    | { status: 'empty' }
    | { status: 'fresh'; summary: RemoteReferenceScanSummary }
    | { status: 'stale'; summary: RemoteReferenceScanSummary };

/** Maps provider objects to conservative Vault reference states. */
export interface RemoteObjectReferenceLookup {
    classify(object: RemoteObject): RemoteReferenceState;
    getReferences(object: RemoteObject): readonly RemoteReferenceLocation[];
}
