import type { RemoteObject } from './types';

export type RemoteResultSort = 'key' | 'size' | 'modified';

export interface RemoteResultPage {
    objects: RemoteObject[];
    total: number;
    pageCount: number;
    pageIndex: number;
}

/** Filter and sort the complete in-memory scan result without UI pagination. */
export function getRemoteResults(
    objects: readonly RemoteObject[],
    keyword: string,
    sortBy: RemoteResultSort
): RemoteObject[] {
    const normalizedKeyword = keyword.trim().toLocaleLowerCase();
    return objects
        .filter((object) => object.key.toLocaleLowerCase().includes(normalizedKeyword))
        .sort((left, right) => {
            if (sortBy === 'size') return left.size - right.size;
            if (sortBy === 'modified') return (left.lastModified ?? 0) - (right.lastModified ?? 0);
            return left.key.localeCompare(right.key);
        });
}

/** Filter and paginate an already scanned metadata set without remote requests. */
export function getRemoteResultPage(
    objects: readonly RemoteObject[],
    keyword: string,
    sortBy: RemoteResultSort,
    pageSize: number,
    requestedPageIndex: number
): RemoteResultPage {
    const filtered = getRemoteResults(objects, keyword, sortBy);
    const safePageSize = Math.max(1, Math.floor(pageSize));
    const pageCount = Math.max(1, Math.ceil(filtered.length / safePageSize));
    const pageIndex = Math.min(Math.max(0, requestedPageIndex), pageCount - 1);
    const start = pageIndex * safePageSize;
    return {
        objects: filtered.slice(start, start + safePageSize),
        total: filtered.length,
        pageCount,
        pageIndex,
    };
}
