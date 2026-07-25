import type { RemoteObject } from './types';

export type RemoteResultSort = 'key' | 'size' | 'modified';

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
