import type { RemoteDeleteAuditEntry, RemoteDeleteFailureCode } from './types';

export const REMOTE_DELETE_HISTORY_LIMIT = 200;

const FAILURE_CODES = new Set<RemoteDeleteFailureCode>([
    'configuration', 'authentication', 'permission', 'not-found', 'rate-limit',
    'network', 'parsing', 'unsupported', 'service', 'unknown', 'conflict',
    'precondition', 'locked',
]);

/** Normalize legacy or user-edited data without retaining unknown fields. */
export function normalizeRemoteDeleteHistory(value: unknown): RemoteDeleteAuditEntry[] {
    if (!Array.isArray(value)) return [];
    return value
        .map(normalizeEntry)
        .filter((entry): entry is RemoteDeleteAuditEntry => entry !== undefined)
        .sort((left, right) => right.completedAt - left.completedAt)
        .slice(0, REMOTE_DELETE_HISTORY_LIMIT);
}

export function prependRemoteDeleteAudit(
    history: readonly RemoteDeleteAuditEntry[],
    entry: RemoteDeleteAuditEntry
): RemoteDeleteAuditEntry[] {
    return [sanitizeEntry(entry), ...history]
        .sort((left, right) => right.completedAt - left.completedAt)
        .slice(0, REMOTE_DELETE_HISTORY_LIMIT);
}

/** Serializes read-modify-save cycles so concurrent request completions cannot overwrite entries. */
export class RemoteDeleteAuditWriter {
    private pending = Promise.resolve();

    constructor(
        private read: () => readonly RemoteDeleteAuditEntry[],
        private write: (history: RemoteDeleteAuditEntry[]) => void,
        private persist: () => Promise<void>
    ) {}

    append(entry: RemoteDeleteAuditEntry): Promise<void> {
        const append = this.pending.catch(() => undefined).then(async () => {
            this.write(prependRemoteDeleteAudit(this.read(), entry));
            await this.persist();
        });
        this.pending = append;
        return append;
    }
}

function normalizeEntry(value: unknown): RemoteDeleteAuditEntry | undefined {
    if (!value || typeof value !== 'object') return undefined;
    const candidate = value as Record<string, unknown>;
    if (
        typeof candidate.completedAt !== 'number' || !Number.isFinite(candidate.completedAt) ||
        typeof candidate.hostingId !== 'string' || !candidate.hostingId ||
        typeof candidate.key !== 'string' || !candidate.key ||
        typeof candidate.success !== 'boolean'
    ) return undefined;
    const failureCode = typeof candidate.failureCode === 'string' &&
        FAILURE_CODES.has(candidate.failureCode as RemoteDeleteFailureCode)
        ? candidate.failureCode as RemoteDeleteFailureCode
        : undefined;
    const deletionKind = candidate.deletionKind === 'permanent' ||
        candidate.deletionKind === 'delete-marker' || candidate.deletionKind === 'unknown'
        ? candidate.deletionKind
        : undefined;
    const status = typeof candidate.status === 'number' && Number.isFinite(candidate.status)
        ? candidate.status
        : undefined;
    return sanitizeEntry({
        completedAt: candidate.completedAt,
        hostingId: candidate.hostingId,
        key: candidate.key,
        success: candidate.success,
        ...(status !== undefined ? { status } : {}),
        ...(deletionKind ? { deletionKind } : {}),
        ...(failureCode ? { failureCode } : {}),
    });
}

function sanitizeEntry(entry: RemoteDeleteAuditEntry): RemoteDeleteAuditEntry {
    return {
        completedAt: entry.completedAt,
        hostingId: entry.hostingId,
        key: entry.key,
        success: entry.success,
        ...(entry.status !== undefined ? { status: entry.status } : {}),
        ...(entry.deletionKind ? { deletionKind: entry.deletionKind } : {}),
        ...(entry.failureCode ? { failureCode: entry.failureCode } : {}),
    };
}
