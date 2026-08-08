export interface IndeterminateScheduler {
    schedule(delay: number, callback: () => void): number;
    cancel(id: number): void;
}

interface IndeterminateEntry {
    path: string;
    activeOwners: number;
    timer?: number;
}

/** Tracks active and recently changed images as a per-image deletion guard. */
export class IndeterminateImageRegistry<T extends object> {
    private readonly entries = new Map<T, IndeterminateEntry>();

    constructor(
        private readonly scheduler: IndeterminateScheduler,
        private readonly protectionDelay = 2_000
    ) {}

    begin(file: T, path: string): void {
        const entry = this.entries.get(file) ?? { path, activeOwners: 0 };
        if (entry.timer !== undefined) this.scheduler.cancel(entry.timer);
        entry.timer = undefined;
        entry.path = path;
        entry.activeOwners++;
        this.entries.set(file, entry);
    }

    touch(file: T, path: string): void {
        const entry = this.entries.get(file) ?? { path, activeOwners: 0 };
        entry.path = path;
        if (entry.activeOwners === 0) this.scheduleExpiry(file, entry);
        this.entries.set(file, entry);
    }

    end(file: T, path: string): void {
        const entry = this.entries.get(file);
        if (!entry) return;
        entry.path = path;
        entry.activeOwners = Math.max(0, entry.activeOwners - 1);
        if (entry.activeOwners === 0) this.scheduleExpiry(file, entry);
    }

    paths(): Set<string> {
        return new Set(Array.from(this.entries.values()).map((entry) => entry.path));
    }

    clear(): void {
        for (const entry of this.entries.values()) {
            if (entry.timer !== undefined) this.scheduler.cancel(entry.timer);
        }
        this.entries.clear();
    }

    private scheduleExpiry(file: T, entry: IndeterminateEntry): void {
        if (entry.timer !== undefined) this.scheduler.cancel(entry.timer);
        entry.timer = this.scheduler.schedule(this.protectionDelay, () => {
            const current = this.entries.get(file);
            if (current !== entry || current.activeOwners > 0) return;
            this.entries.delete(file);
        });
    }
}
