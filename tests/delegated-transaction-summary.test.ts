import { describe, expect, it } from 'vitest';
import { summarizeDelegatedTransaction } from '../src/lifecycle/delegated-transaction-summary';

describe('delegated transaction summary', () => {
    it('emits one success result for a fully successful transaction', () => {
        expect(summarizeDelegatedTransaction([{ status: 'success' }, { status: 'success' }])).toEqual({
            kind: 'success', success: 2, cancelled: 0, failed: 0,
        });
    });

    it('keeps an entirely user-cancelled transaction silent', () => {
        expect(summarizeDelegatedTransaction([{ status: 'cancelled' }])).toEqual({
            kind: 'silent', success: 0, cancelled: 1, failed: 0,
        });
    });

    it('aggregates partial and unapplied results with the first safe reason', () => {
        expect(summarizeDelegatedTransaction([
            { status: 'success' },
            { status: 'cancelled' },
            { status: 'unapplied', reason: 'reference changed' },
        ])).toEqual({
            kind: 'summary', success: 1, cancelled: 1, failed: 1, reason: 'reference changed',
        });
    });
});
