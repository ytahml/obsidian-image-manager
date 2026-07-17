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
    canvasIncluded: false;
}

/** Lifecycle state for the in-memory Vault reference index. */
export type RemoteReferenceIndexState =
    | { status: 'empty' }
    | { status: 'fresh'; summary: RemoteReferenceScanSummary }
    | { status: 'stale'; summary: RemoteReferenceScanSummary };

/** Maps provider objects to conservative Vault reference states. */
export interface RemoteObjectReferenceLookup {
    classify(object: RemoteObject): RemoteReferenceState;
}
