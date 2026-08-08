import { describe, expect, it } from 'vitest';
import { DelegatedTransactionMatcher } from '../src/lifecycle/delegated-transaction-matcher';

describe('DelegatedTransactionMatcher', () => {
    it('does not assign a created image until the transaction difference proves a unique reference mapping', () => {
        const matcher = new DelegatedTransactionMatcher(1);
        matcher.observeCandidate('file-a', 'attachments/a.png');

        expect(matcher.propose([])).toEqual([]);
        expect(matcher.propose([
            { fileId: 'file-a', filePath: 'attachments/a.png', referenceId: '![](attachments/a.png)' },
        ])).toEqual([
            { itemIndex: 0, fileId: 'file-a', filePath: 'attachments/a.png', referenceId: '![](attachments/a.png)' },
        ]);
    });

    it('fails closed when unrelated creates or identical reference identities make ownership ambiguous', () => {
        const matcher = new DelegatedTransactionMatcher(1);
        matcher.observeCandidate('file-a', 'attachments/a.png');
        matcher.observeCandidate('file-b', 'attachments/b.png');

        expect(matcher.propose([
            { fileId: 'file-a', filePath: 'attachments/a.png', referenceId: '![](attachments/a.png)' },
            { fileId: 'file-b', filePath: 'attachments/b.png', referenceId: '![](attachments/b.png)' },
        ])).toEqual([]);

        const duplicate = new DelegatedTransactionMatcher(1);
        duplicate.observeCandidate('file-a', 'attachments/a.png');
        expect(duplicate.propose([
            { fileId: 'file-a', filePath: 'attachments/a.png', referenceId: '![](attachments/a.png)' },
            { fileId: 'file-a', filePath: 'attachments/a.png', referenceId: '![](attachments/a.png)' },
        ])).toEqual([]);
    });

    it('keeps already claimed items stable while matching a later item', () => {
        const matcher = new DelegatedTransactionMatcher(2);
        matcher.observeCandidate('file-a', 'attachments/a.png');
        matcher.observeCandidate('file-b', 'attachments/b.png');
        matcher.claim({ itemIndex: 0, fileId: 'file-a', filePath: 'attachments/a.png', referenceId: 'ref-a' });

        expect(matcher.propose([
            { fileId: 'file-a', filePath: 'attachments/a.png', referenceId: 'ref-a' },
            { fileId: 'file-b', filePath: 'attachments/b.png', referenceId: 'ref-b' },
        ])).toEqual([
            { itemIndex: 1, fileId: 'file-b', filePath: 'attachments/b.png', referenceId: 'ref-b' },
        ]);
    });

    it('claims a uniquely proven item without letting an ambiguous item block it', () => {
        const matcher = new DelegatedTransactionMatcher(2);
        matcher.observeCandidate('file-a', 'attachments/a.png');
        matcher.observeCandidate('file-b', 'attachments/b.png');

        expect(matcher.propose([
            { fileId: 'file-a', filePath: 'attachments/a.png', referenceId: 'ref-a' },
            { fileId: 'file-b', filePath: 'attachments/b.png', referenceId: 'same-ref' },
            { fileId: 'file-b', filePath: 'attachments/b.png', referenceId: 'same-ref' },
        ])).toEqual([
            { itemIndex: 0, fileId: 'file-a', filePath: 'attachments/a.png', referenceId: 'ref-a' },
        ]);
    });

    it('ignores files already proven to belong to another overlapping transaction', () => {
        const matcher = new DelegatedTransactionMatcher(1);
        matcher.observeCandidate('file-a', 'attachments/a.png');
        matcher.observeCandidate('file-b', 'attachments/b.png');

        expect(matcher.propose([
            { fileId: 'file-a', filePath: 'attachments/a.png', referenceId: 'ref-a' },
            { fileId: 'file-b', filePath: 'attachments/b.png', referenceId: 'ref-b' },
        ], new Set(['file-b']))).toEqual([
            { itemIndex: 0, fileId: 'file-a', filePath: 'attachments/a.png', referenceId: 'ref-a' },
        ]);
    });
});
