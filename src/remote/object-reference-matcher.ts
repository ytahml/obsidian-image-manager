import type {
    RemoteObject,
    RemoteObjectReferenceLookup,
    RemoteReferenceState,
    RemoteUrlMapping,
} from './types';

export type IndexedRemoteReferenceKind = 'referenced' | 'possibly-referenced';

export interface IndexedRemoteReference {
    kind: IndexedRemoteReferenceKind;
    origin: string;
    pathSegments?: readonly string[];
    queryParameterNames: ReadonlySet<string>;
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
    kind: IndexedRemoteReferenceKind
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
    const ignoredQueryParameters = new Set(mapping.ignoredQueryParameters ?? []);
    const referencedKeys = new Set<string>();
    const possibleKeys = new Set<string>();
    const unmappableKeys = new Set<string>();
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

            if (!reference.pathSegments || hasUnignoredQueryParameter(reference, ignoredQueryParameters)) {
                for (const key of matchedKeys) unmappableKeys.add(key);
                continue;
            }

            if (new Set(matchedKeys).size > 1) {
                hasUnmappableManagedReference = true;
                continue;
            }

            const key = matchedKeys[0]!;
            if (reference.kind === 'referenced') {
                referencedKeys.add(key);
            } else {
                possibleKeys.add(key);
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
            if (possibleKeys.has(normalizedKey)) return 'possibly-referenced';
            if (unmappableKeys.has(normalizedKey)) return 'unmappable';
            return 'not-referenced-in-current-vault';
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

function hasUnignoredQueryParameter(
    reference: IndexedRemoteReference,
    ignoredQueryParameters: ReadonlySet<string>
): boolean {
    for (const name of reference.queryParameterNames) {
        if (!ignoredQueryParameters.has(name)) return true;
    }
    return false;
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
