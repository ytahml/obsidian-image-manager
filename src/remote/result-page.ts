import type { RemoteObject } from './types';

export type RemoteResultSort = 'key' | 'size' | 'modified';

export interface RemoteResultPage {
    objects: RemoteObject[];
    total: number;
    pageCount: number;
    pageIndex: number;
}

/** Filter and paginate an already scanned metadata set without remote requests. */
export function getRemoteResultPage(
    objects: readonly RemoteObject[],
    keyword: string,
    sortBy: RemoteResultSort,
    pageSize: number,
    requestedPageIndex: number
): RemoteResultPage {
    const normalizedKeyword = keyword.toLocaleLowerCase();
    const filtered = objects
        .filter((object) => object.key.toLocaleLowerCase().includes(normalizedKeyword))
        .sort((left, right) => {
            if (sortBy === 'size') return left.size - right.size;
            if (sortBy === 'modified') return (left.lastModified ?? 0) - (right.lastModified ?? 0);
            return left.key.localeCompare(right.key);
        });
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
