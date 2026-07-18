import { describe, expect, it } from 'vitest';
import {
    REMOTE_DELETE_HISTORY_LIMIT,
    RemoteDeleteAuditWriter,
    normalizeRemoteDeleteHistory,
    prependRemoteDeleteAudit,
} from '../src/remote/delete-audit';
import type { RemoteDeleteAuditEntry } from '../src/remote/types';

describe('remote delete audit', () => {
    it('migrates missing or malformed history to a redacted array', () => {
        expect(normalizeRemoteDeleteHistory(undefined)).toEqual([]);
        expect(normalizeRemoteDeleteHistory([{
            completedAt: 2, hostingId: 's3', key: 'a.png', success: false,
            status: 403, failureCode: 'permission', endpoint: 'secret-host',
            Authorization: 'secret',
        }])).toEqual([{
            completedAt: 2, hostingId: 's3', key: 'a.png', success: false,
            status: 403, failureCode: 'permission',
        }]);
    });

    it('keeps the most recent 200 entries in descending completion order', () => {
        let history: RemoteDeleteAuditEntry[] = [];
        for (let index = 0; index < REMOTE_DELETE_HISTORY_LIMIT + 5; index++) {
            history = prependRemoteDeleteAudit(history, {
                completedAt: index, hostingId: 's3', key: `${index}.png`, success: true,
                status: 204, deletionKind: 'unknown',
            });
        }
        expect(history).toHaveLength(REMOTE_DELETE_HISTORY_LIMIT);
        expect(history[0]?.completedAt).toBe(204);
        expect(history[history.length - 1]?.completedAt).toBe(5);
        expect(JSON.stringify(history)).not.toContain('Authorization');
        expect(JSON.stringify(history)).not.toContain('X-Amz-');
    });

    it('serializes concurrent completions without losing persisted entries', async () => {
        let history: RemoteDeleteAuditEntry[] = [];
        const snapshots: RemoteDeleteAuditEntry[][] = [];
        const writer = new RemoteDeleteAuditWriter(
            () => history,
            (next) => { history = next; },
            async () => { snapshots.push([...history]); }
        );

        await Promise.all([1, 2, 3].map((completedAt) => writer.append({
            completedAt, hostingId: 's3', key: `${completedAt}.png`, success: true,
            status: 204, deletionKind: 'unknown',
        })));

        expect(history.map((entry) => entry.completedAt)).toEqual([3, 2, 1]);
        expect(snapshots.map((snapshot) => snapshot.length)).toEqual([1, 2, 3]);
    });

    it('continues serializing later entries after one persistence failure', async () => {
        let history: RemoteDeleteAuditEntry[] = [];
        let saves = 0;
        const writer = new RemoteDeleteAuditWriter(
            () => history,
            (next) => { history = next; },
            async () => {
                saves++;
                if (saves === 1) throw new Error('disk unavailable');
            }
        );

        await expect(writer.append({
            completedAt: 1, hostingId: 's3', key: 'one.png', success: true,
        })).rejects.toThrow('disk unavailable');
        await expect(writer.append({
            completedAt: 2, hostingId: 's3', key: 'two.png', success: true,
        })).resolves.toBeUndefined();

        expect(history.map((entry) => entry.key)).toEqual(['two.png', 'one.png']);
    });
});
