export interface LifecycleScheduler {
    schedule(delay: number, callback: () => void): number;
    cancel(id: number): void;
}

export type PasteLifecycleCancelReason = 'timeout' | 'unload' | 'cancelled' | 'ambiguous';

export interface HandoffReadyItem {
    transactionId: string;
    itemIndex: number;
    notePath: string;
    fileId: string;
    filePath: string;
    referenceId: string;
}

export interface PasteLifecycleCancellation {
    transactionId: string;
    notePath: string;
    reason: PasteLifecycleCancelReason;
}

interface LifecycleItem {
    fileId?: string;
    filePath?: string;
    referenceId?: string;
    readyTimer?: number;
    state: 'pending' | 'in-flight' | 'completed';
}

interface LifecycleTransaction {
    id: string;
    notePath: string;
    items: LifecycleItem[];
    timeoutTimer: number;
    cancelled: boolean;
}

const STRONG_CONVERGENCE_DELAY = 200;
const WEAK_CONVERGENCE_DELAY = 800;
const HARD_TIMEOUT_DELAY = 30_000;

/** Pure in-memory transaction coordinator for delegated paste/drop handoff. */
export class PasteLifecycleCoordinator {
    private readonly transactions = new Map<string, LifecycleTransaction>();
    private nextId = 1;

    constructor(
        private readonly scheduler: LifecycleScheduler,
        private readonly onReady: (item: HandoffReadyItem) => void,
        private readonly onCancelled: (cancellation: PasteLifecycleCancellation) => void
    ) {}

    start(notePath: string, itemCount: number): string {
        const id = `paste-${this.nextId++}`;
        const transaction: LifecycleTransaction = {
            id,
            notePath,
            items: Array.from({ length: itemCount }, () => ({ state: 'pending' })),
            timeoutTimer: -1,
            cancelled: false,
        };
        transaction.timeoutTimer = this.scheduler.schedule(HARD_TIMEOUT_DELAY, () => {
            const current = this.transactions.get(id);
            if (!current || current.cancelled || current.items.every((item) => item.state === 'completed')) return;
            this.cancel(id, 'timeout');
        });
        this.transactions.set(id, transaction);
        return id;
    }

    observeCandidate(transactionId: string, itemIndex: number, fileId: string, filePath: string): void {
        const item = this.getPendingItem(transactionId, itemIndex);
        if (!item) return;
        item.fileId = fileId;
        item.filePath = filePath;
    }

    observeReference(
        transactionId: string,
        itemIndex: number,
        fileId: string,
        referenceId: string,
        strongConvergence: boolean
    ): void {
        const transaction = this.transactions.get(transactionId);
        const currentItem = transaction?.items[itemIndex];
        if (currentItem?.state === 'in-flight') {
            if (currentItem.referenceId !== referenceId) this.cancel(transactionId, 'ambiguous');
            return;
        }
        const item = this.getPendingItem(transactionId, itemIndex);
        if (!transaction || !item || item.fileId !== fileId || !item.filePath) return;

        if (item.readyTimer !== undefined) this.scheduler.cancel(item.readyTimer);
        item.referenceId = referenceId;
        const delay = strongConvergence ? STRONG_CONVERGENCE_DELAY : WEAK_CONVERGENCE_DELAY;
        item.readyTimer = this.scheduler.schedule(delay, () => {
            const current = this.transactions.get(transactionId);
            const currentItem = current?.items[itemIndex];
            if (!current || current.cancelled || !currentItem || currentItem.state !== 'pending') return;
            if (!currentItem.fileId || !currentItem.filePath || !currentItem.referenceId) return;
            currentItem.state = 'in-flight';
            this.onReady({
                transactionId,
                itemIndex,
                notePath: current.notePath,
                fileId: currentItem.fileId,
                filePath: currentItem.filePath,
                referenceId: currentItem.referenceId,
            });
        });
    }

    invalidate(transactionId: string, itemIndex: number): void {
        const transaction = this.transactions.get(transactionId);
        const item = transaction?.items[itemIndex];
        if (!item) return;
        if (item.state === 'in-flight') {
            this.cancel(transactionId, 'ambiguous');
            return;
        }
        if (item.state === 'completed') return;
        if (item.readyTimer !== undefined) this.scheduler.cancel(item.readyTimer);
        item.readyTimer = undefined;
        item.referenceId = undefined;
    }

    cancel(transactionId: string, reason: PasteLifecycleCancelReason = 'cancelled'): void {
        const transaction = this.transactions.get(transactionId);
        if (!transaction || transaction.cancelled) return;
        transaction.cancelled = true;
        this.scheduler.cancel(transaction.timeoutTimer);
        for (const item of transaction.items) {
            if (item.readyTimer !== undefined) this.scheduler.cancel(item.readyTimer);
        }
        this.transactions.delete(transactionId);
        this.onCancelled({ transactionId, notePath: transaction.notePath, reason });
    }

    cancelAll(reason: PasteLifecycleCancelReason): void {
        for (const id of Array.from(this.transactions.keys())) this.cancel(id, reason);
    }

    isCurrent(transactionId: string, itemIndex: number, referenceId: string): boolean {
        const item = this.transactions.get(transactionId)?.items[itemIndex];
        return item?.state === 'in-flight' && item.referenceId === referenceId;
    }

    complete(transactionId: string, itemIndex: number): void {
        const transaction = this.transactions.get(transactionId);
        const item = transaction?.items[itemIndex];
        if (!transaction || !item || item.state !== 'in-flight') return;
        item.state = 'completed';
        this.finishIfComplete(transaction);
    }

    private getPendingItem(transactionId: string, itemIndex: number): LifecycleItem | undefined {
        const transaction = this.transactions.get(transactionId);
        if (!transaction || transaction.cancelled) return undefined;
        const item = transaction.items[itemIndex];
        if (!item || item.state !== 'pending') return undefined;
        return item;
    }

    private finishIfComplete(transaction: LifecycleTransaction): void {
        if (!transaction.items.every((item) => item.state === 'completed')) return;
        this.scheduler.cancel(transaction.timeoutTimer);
        this.transactions.delete(transaction.id);
    }
}
