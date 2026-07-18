import { describe, expect, it, vi } from 'vitest';
import type { ImageHostingConfig, RemoteManagementConfig } from '../src/types';
import type { RemoteObjectProvider } from '../src/remote/provider';
import type { RemoteObject, RemoteReferenceState } from '../src/remote/types';
import {
    REMOTE_DELETE_BATCH_LIMIT,
    RemoteDeleteSession,
} from '../src/remote/delete-session';
import {
    getRemoteDeleteUnavailableReason,
    isKeyInRemotePrefix,
    type RemoteDeleteEligibilityContext,
} from '../src/remote/delete-policy';

function config(): ImageHostingConfig {
    return {
        id: 's3-test', name: 'S3', type: 's3', enabled: true,
        config: {
            endpoint: 'https://minio.example.com:9000/base', region: 'us-east-1',
            accessKeyId: 'access', secretAccessKey: 'secret', bucket: 'images',
            forcePathStyle: true,
        },
        uploadPath: '', urlPrefix: '',
        remoteManagement: {
            enabled: true, prefix: 'vault-a', pageSize: 10, previewMode: 'manual',
            previewAccess: 'presigned', publicUrlAliases: [],
        },
    };
}

function object(index: number): RemoteObject {
    return { hostingId: 's3-test', key: `vault-a/${index}.png`, size: index };
}

function context(
    objects: readonly RemoteObject[],
    state: RemoteReferenceState = 'not-referenced-in-current-vault'
): RemoteDeleteEligibilityContext {
    const provider: RemoteObjectProvider = {
        capabilities: new Set(['list', 'delete']),
        listObjects: vi.fn(),
        deleteObject: vi.fn(),
    };
    return {
        config: config(), provider,
        indexState: {
            status: 'fresh',
            summary: {
                scannedAt: 123, markdownFileCount: 1, referencedCount: 0,
                possiblyReferencedCount: 0, unmappableCount: 0,
            },
        },
        scannedObjects: objects,
        classify: () => state,
    };
}

describe('remote delete safety policy', () => {
    it('requires a fresh index, exact hosting, directory boundary, current scan, and unreferenced state', () => {
        const candidate = object(1);
        const base = context([candidate]);
        expect(getRemoteDeleteUnavailableReason(candidate, base)).toBeUndefined();
        expect(getRemoteDeleteUnavailableReason(candidate, { ...base, indexState: { status: 'empty' } }))
            .toBe('index-empty');
        expect(getRemoteDeleteUnavailableReason(candidate, context([candidate], 'referenced')))
            .toBe('referenced');
        expect(getRemoteDeleteUnavailableReason({ ...candidate, hostingId: 'other' }, base))
            .toBe('wrong-hosting');
        expect(getRemoteDeleteUnavailableReason({ ...candidate, key: 'vault-ab/1.png' }, base))
            .toBe('outside-prefix');
        expect(getRemoteDeleteUnavailableReason(object(2), base)).toBe('not-in-scan');
        expect(isKeyInRemotePrefix('vault-a/nested/a.png', 'vault-a')).toBe(true);
        expect(isKeyInRemotePrefix('vault-ab/a.png', 'vault-a')).toBe(false);
    });

    it.each([
        ['referenced', 'referenced'],
        ['possibly-referenced', 'possibly-referenced'],
        ['unmappable', 'unmappable'],
    ] as const)('blocks the %s reference state', (state, reason) => {
        const candidate = object(1);
        expect(getRemoteDeleteUnavailableReason(candidate, context([candidate], state))).toBe(reason);
    });

    it('enables deletion with remote management and blocks unsupported or stale contexts', () => {
        const candidate = object(1);
        const disabled = context([candidate]);
        disabled.config.remoteManagement!.enabled = false;
        expect(getRemoteDeleteUnavailableReason(candidate, disabled)).toBe('unsupported');

        expect(getRemoteDeleteUnavailableReason(candidate, context([candidate]))).toBeUndefined();

        const legacy = context([candidate]);
        (legacy.config.remoteManagement as RemoteManagementConfig & { deleteEnabled: boolean })
            .deleteEnabled = false;
        expect(getRemoteDeleteUnavailableReason(candidate, legacy)).toBeUndefined();

        const unsupported = context([candidate]);
        unsupported.provider = { capabilities: new Set(['list']), listObjects: vi.fn() };
        expect(getRemoteDeleteUnavailableReason(candidate, unsupported)).toBe('unsupported');

        const stale = context([candidate]);
        if (stale.indexState.status !== 'fresh') throw new Error('Expected fresh test index');
        stale.indexState = { status: 'stale', summary: stale.indexState.summary };
        expect(getRemoteDeleteUnavailableReason(candidate, stale)).toBe('index-stale');
    });

    it('enforces the 20 item limit in shared code', () => {
        const objects = Array.from({ length: REMOTE_DELETE_BATCH_LIMIT + 1 }, (_, index) => object(index));
        const session = new RemoteDeleteSession();
        const eligibility = context(objects);
        for (const candidate of objects.slice(0, REMOTE_DELETE_BATCH_LIMIT)) {
            expect(session.setSelected(candidate, true, eligibility).selected).toBe(true);
        }
        expect(session.setSelected(objects[REMOTE_DELETE_BATCH_LIMIT]!, true, eligibility))
            .toEqual({ selected: false, reason: 'limit' });
    });

    it('rejects config, scan time, and freshness drift before execution', () => {
        const candidate = object(1);
        const session = new RemoteDeleteSession();
        const original = context([candidate]);
        session.setSelected(candidate, true, original);
        const batch = session.createBatch(original)!;

        expect(session.validateBatch(batch, original)).toBe(true);
        const changed = context([candidate]);
        changed.config.remoteManagement!.prefix = 'other';
        expect(session.validateBatch(batch, changed)).toBe(false);
        if (original.indexState.status !== 'fresh') throw new Error('Expected fresh test index');
        expect(session.validateBatch(batch, {
            ...original,
            indexState: { status: 'stale', summary: original.indexState.summary },
        })).toBe(false);
    });
});

describe('remote delete scheduling', () => {
    it('runs at most two requests concurrently without automatic retries', async () => {
        const objects = Array.from({ length: 6 }, (_, index) => object(index));
        const eligibility = context(objects);
        const session = new RemoteDeleteSession();
        session.replaceSelection(objects, eligibility);
        const batch = session.createBatch(eligibility)!;
        let active = 0;
        let maximum = 0;
        const deleteObject = vi.fn(async (candidate: RemoteObject) => {
            active++;
            maximum = Math.max(maximum, active);
            await Promise.resolve();
            active--;
            return { key: candidate.key, success: true, status: 204, deletionKind: 'unknown' as const };
        });
        const provider: RemoteObjectProvider = {
            capabilities: new Set(['delete']), listObjects: vi.fn(), deleteObject,
        };

        const results = await session.run(provider, batch);

        expect(maximum).toBe(2);
        expect(results).toHaveLength(6);
        expect(deleteObject).toHaveBeenCalledTimes(6);
    });

    it('stops scheduling unsent objects while retaining in-flight results', async () => {
        const objects = Array.from({ length: 5 }, (_, index) => object(index));
        const eligibility = context(objects);
        const session = new RemoteDeleteSession();
        session.replaceSelection(objects, eligibility);
        const batch = session.createBatch(eligibility)!;
        const finishes: Array<() => void> = [];
        const deleteObject = vi.fn((candidate: RemoteObject) => new Promise<{
            key: string; success: boolean; status: number; deletionKind: 'unknown';
        }>((resolve) => finishes.push(() => resolve({
            key: candidate.key, success: true, status: 204, deletionKind: 'unknown',
        }))));
        const onResult = vi.fn();
        const pending = session.run({
            capabilities: new Set(['delete']), listObjects: vi.fn(), deleteObject,
        }, batch, { onResult });
        await vi.waitFor(() => expect(deleteObject).toHaveBeenCalledTimes(2));

        session.stop();
        finishes.splice(0).forEach((finish) => finish());
        const results = await pending;

        expect(deleteObject).toHaveBeenCalledTimes(2);
        expect(results).toHaveLength(2);
        expect(onResult).toHaveBeenCalledTimes(2);
    });
});
