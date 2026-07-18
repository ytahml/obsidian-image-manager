import type {
    RemoteObject,
    RemoteObjectReferenceLookup,
    RemoteReferenceLocation,
    RemoteReferenceState,
    RemoteUrlMapping,
} from './types';

export type IndexedRemoteReferenceKind = 'markdown-image' | 'url';

export interface IndexedRemoteReference {
    kind: IndexedRemoteReferenceKind;
    origin: string;
    pathSegments?: readonly string[];
    queryParameterNames: ReadonlySet<string>;
    location?: RemoteReferenceLocation;
}

interface NormalizedBaseUrl {
    origin: string;
    pathSegments: readonly string[];
}

interface LookupOptions {
    isComplete: boolean;
}

/** Parse an absolute URL without retaining query values or fragments. */
export function indexRemoteReference(
    value: string,
    kind: IndexedRemoteReferenceKind,
    location?: Omit<RemoteReferenceLocation, 'syntax'>
): IndexedRemoteReference | null {
    let url: URL;
    try {
        url = new URL(value);
    } catch {
        return null;
    }

    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;

    return {
        kind,
        origin: url.origin,
        pathSegments: decodeUrlPath(url.pathname),
        queryParameterNames: new Set(url.searchParams.keys()),
        ...(location ? { location: { ...location, syntax: kind } } : {}),
    };
}

/** Build a conservative lookup from an already-scanned Vault index. */
export function createRemoteObjectReferenceLookup(
    mapping: RemoteUrlMapping,
    references: readonly IndexedRemoteReference[],
    options: LookupOptions
): RemoteObjectReferenceLookup {
    const bases = [mapping.urlPrefix, ...mapping.publicUrlAliases]
        .map(normalizeBaseUrl)
        .filter((base): base is NormalizedBaseUrl => base !== null);
    const referencedKeys = new Set<string>();
    const locationsByKey = new Map<string, RemoteReferenceLocation[]>();
    let hasUnmappableManagedReference = false;

    if (bases.length > 0) {
        for (const reference of references) {
            if (!reference.pathSegments) {
                if (bases.some((base) => base.origin === reference.origin)) {
                    hasUnmappableManagedReference = true;
                }
                continue;
            }
            const matchedKeys = getMatchedKeys(reference, bases);
            if (matchedKeys.length === 0) continue;

            if (new Set(matchedKeys).size > 1) {
                hasUnmappableManagedReference = true;
                continue;
            }

            const key = matchedKeys[0]!;
            referencedKeys.add(key);
            if (reference.location) {
                const locations = locationsByKey.get(key) ?? [];
                if (!locations.some((item) =>
                    item.path === reference.location!.path && item.line === reference.location!.line
                )) locations.push(reference.location);
                locationsByKey.set(key, locations);
            }
        }
    }

    return {
        classify(object: RemoteObject): RemoteReferenceState {
            if (!options.isComplete || object.hostingId !== mapping.hostingId || bases.length === 0) {
                return 'unmappable';
            }

            const normalizedKey = normalizeObjectKey(object.key);
            if (normalizedKey === null || hasUnmappableManagedReference) return 'unmappable';
            if (referencedKeys.has(normalizedKey)) return 'referenced';
            return 'not-referenced-in-current-vault';
        },
        getReferences(object: RemoteObject): readonly RemoteReferenceLocation[] {
            if (!options.isComplete || object.hostingId !== mapping.hostingId) return [];
            const normalizedKey = normalizeObjectKey(object.key);
            return normalizedKey === null ? [] : [...(locationsByKey.get(normalizedKey) ?? [])];
        },
    };
}

function normalizeBaseUrl(value: string): NormalizedBaseUrl | null {
    if (!value) return null;

    let url: URL;
    try {
        url = new URL(value);
    } catch {
        return null;
    }

    if (
        (url.protocol !== 'http:' && url.protocol !== 'https:') ||
        url.username ||
        url.password ||
        url.search ||
        url.hash
    ) {
        return null;
    }

    const pathSegments = decodeUrlPath(url.pathname.replace(/\/+$/, ''));
    return pathSegments ? { origin: url.origin, pathSegments } : null;
}

function getMatchedKeys(
    reference: IndexedRemoteReference,
    bases: readonly NormalizedBaseUrl[]
): string[] {
    if (!reference.pathSegments) return [];

    const keys: string[] = [];
    for (const base of bases) {
        if (reference.origin !== base.origin || !startsWithSegments(reference.pathSegments, base.pathSegments)) {
            continue;
        }
        keys.push(reference.pathSegments.slice(base.pathSegments.length).join('/'));
    }
    return keys;
}

function startsWithSegments(value: readonly string[], prefix: readonly string[]): boolean {
    if (prefix.length > value.length) return false;
    return prefix.every((segment, index) => value[index] === segment);
}

function normalizeObjectKey(key: string): string | null {
    return key.includes('\u0000') ? null : key;
}

function decodeUrlPath(pathname: string): string[] | undefined {
    const rawPath = pathname.startsWith('/') ? pathname.slice(1) : pathname;
    if (!rawPath) return [];
    const segments = rawPath.split('/').map(decodePathSegment);
    return segments.every((segment): segment is string => segment !== null) ? segments : undefined;
}

function decodePathSegment(segment: string): string | null {
    try {
        return decodeURIComponent(segment.replace(/%2f/gi, '%252F'));
    } catch {
        return null;
    }
}
