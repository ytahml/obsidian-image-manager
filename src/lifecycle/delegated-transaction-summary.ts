export interface DelegatedTransactionOutcome {
    status: 'success' | 'cancelled' | 'failed' | 'unapplied';
    reason?: string;
}

export interface DelegatedTransactionSummary {
    kind: 'success' | 'silent' | 'summary';
    success: number;
    cancelled: number;
    failed: number;
    reason?: string;
}

export function summarizeDelegatedTransaction(
    outcomes: readonly DelegatedTransactionOutcome[]
): DelegatedTransactionSummary {
    const success = outcomes.filter((outcome) => outcome.status === 'success').length;
    const cancelled = outcomes.filter((outcome) => outcome.status === 'cancelled').length;
    const failed = outcomes.length - success - cancelled;
    if (success === outcomes.length) return { kind: 'success', success, cancelled, failed };
    if (cancelled === outcomes.length) return { kind: 'silent', success, cancelled, failed };
    return {
        kind: 'summary',
        success,
        cancelled,
        failed,
        ...(outcomes.find((outcome) => outcome.reason)?.reason
            ? { reason: outcomes.find((outcome) => outcome.reason)!.reason }
            : {}),
    };
}
