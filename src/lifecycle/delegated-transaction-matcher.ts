export interface DelegatedResolvedReference {
    fileId: string;
    filePath: string;
    referenceId: string;
}

export interface DelegatedItemClaim extends DelegatedResolvedReference {
    itemIndex: number;
}

/** Matches transaction differences without assigning create events by FIFO or timing. */
export class DelegatedTransactionMatcher {
    private readonly candidates = new Map<string, string>();
    private readonly claims = new Map<number, DelegatedItemClaim>();

    constructor(private readonly itemCount: number) {}

    observeCandidate(fileId: string, filePath: string): void {
        this.candidates.set(fileId, filePath);
        const claim = Array.from(this.claims.values()).find((item) => item.fileId === fileId);
        if (claim) claim.filePath = filePath;
    }

    observesCandidate(fileId: string): boolean {
        return this.candidates.has(fileId);
    }

    removeCandidate(fileId: string): void {
        this.candidates.delete(fileId);
    }

    propose(
        references: readonly DelegatedResolvedReference[],
        excludedFileIds: ReadonlySet<string> = new Set()
    ): DelegatedItemClaim[] {
        const claimedFiles = new Set(Array.from(this.claims.values()).map((claim) => claim.fileId));
        const unclaimedIndexes: number[] = [];
        for (let index = 0; index < this.itemCount; index++) {
            if (!this.claims.has(index)) unclaimedIndexes.push(index);
        }
        if (unclaimedIndexes.length === 0) return [];

        const matches = references.filter((reference) =>
            this.candidates.has(reference.fileId) &&
            !claimedFiles.has(reference.fileId) &&
            !excludedFileIds.has(reference.fileId)
        );
        const referenceCounts = new Map<string, number>();
        const fileCounts = new Map<string, number>();
        for (const match of matches) {
            referenceCounts.set(match.referenceId, (referenceCounts.get(match.referenceId) ?? 0) + 1);
            fileCounts.set(match.fileId, (fileCounts.get(match.fileId) ?? 0) + 1);
        }
        const uniqueMatches = matches.filter((match) =>
            referenceCounts.get(match.referenceId) === 1 && fileCounts.get(match.fileId) === 1
        );
        if (uniqueMatches.length === 0 || uniqueMatches.length > unclaimedIndexes.length) return [];

        return uniqueMatches.map((match, index) => ({ ...match, itemIndex: unclaimedIndexes[index]! }));
    }

    claim(claim: DelegatedItemClaim): void {
        this.claims.set(claim.itemIndex, { ...claim });
    }
}
