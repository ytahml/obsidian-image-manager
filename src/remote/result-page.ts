import type { RemoteImageBrowserSort, SortOrder } from '../types';
import type { RemoteObject } from './types';

export type RemoteResultSort = RemoteImageBrowserSort;

/** Filter and sort the complete in-memory scan result without UI pagination. */
export function getRemoteResults(
    objects: readonly RemoteObject[],
    keyword: string,
    sortBy: RemoteResultSort,
    order: SortOrder = 'asc'
): RemoteObject[] {
    const normalizedKeyword = keyword.trim().toLocaleLowerCase();
    return objects
        .filter((object) => object.key.toLocaleLowerCase().includes(normalizedKeyword))
        .sort((left, right) => compareRemoteObjects(left, right, sortBy, order));
}

function compareRemoteObjects(
    left: RemoteObject,
    right: RemoteObject,
    sortBy: RemoteResultSort,
    order: SortOrder
): number {
    if (sortBy === 'modified') {
        const modifiedComparison = compareModified(left.lastModified, right.lastModified, order);
        if (modifiedComparison !== 0) return modifiedComparison;
    } else if (sortBy === 'size') {
        const sizeComparison = compareInOrder(left.size, right.size, order);
        if (sizeComparison !== 0) return sizeComparison;
    } else {
        return compareInOrder(left.key.localeCompare(right.key), 0, order);
    }
    return left.key.localeCompare(right.key);
}

function compareModified(
    left: number | undefined,
    right: number | undefined,
    order: SortOrder
): number {
    if (left === undefined) return right === undefined ? 0 : 1;
    if (right === undefined) return -1;
    return compareInOrder(left, right, order);
}

function compareInOrder(left: number, right: number, order: SortOrder): number {
    const comparison = left - right;
    return order === 'asc' ? comparison : -comparison;
}
