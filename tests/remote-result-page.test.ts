import { describe, expect, it } from 'vitest';
import { getRemoteResultPage } from '../src/remote/result-page';
import type { RemoteObject } from '../src/remote/types';

function object(key: string): RemoteObject {
    return { hostingId: 's3-test', key, size: 1 };
}

describe('remote result pagination', () => {
    it('paginates matching objects after remote batches have been aggregated', () => {
        const firstRemoteBatch = Array.from({ length: 7 }, (_, index) => object(`images/a-${index}.png`));
        const secondRemoteBatch = Array.from({ length: 8 }, (_, index) => object(`images/a-${index + 7}.png`));
        const allObjects = [...firstRemoteBatch, object('images/other.png'), ...secondRemoteBatch];

        const first = getRemoteResultPage(allObjects, 'a-', 'key', 10, 0);
        const second = getRemoteResultPage(allObjects, 'a-', 'key', 10, 1);

        expect(first.total).toBe(15);
        expect(first.pageCount).toBe(2);
        expect(first.objects).toHaveLength(10);
        expect(second.objects).toHaveLength(5);
    });
});
