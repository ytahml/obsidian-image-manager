export interface RenameRepairScheduler {
    schedule(delay: number, callback: () => void): number;
    cancel(id: number): void;
}

export interface RenameRepairEntry {
    oldPath: string;
    newPath: string;
}

/** Coalesces rename chains and guarantees that whole-vault repair batches never overlap. */
export class ExternalRenameRepairCoordinator<T extends object> {
    private readonly pending = new Map<T, RenameRepairEntry>();
    private timer: number | undefined;
    private running: Promise<void> | null = null;
    private readyWhileRunning = false;
    private generation = 0;

    constructor(
        private readonly scheduler: RenameRepairScheduler,
        private readonly repair: (entries: readonly RenameRepairEntry[]) => Promise<unknown>,
        private readonly delay = 2_000,
        private readonly canRepair: (file: T) => boolean = () => true
    ) {}

    observe(file: T, oldPath: string, newPath: string): void {
        const existing = this.pending.get(file);
        this.pending.set(file, { oldPath: existing?.oldPath ?? oldPath, newPath });
        if (this.timer !== undefined) this.scheduler.cancel(this.timer);
        this.timer = this.scheduler.schedule(this.delay, () => {
            this.timer = undefined;
            this.startDrain();
        });
    }

    forget(file: T): void {
        this.pending.delete(file);
        if (this.pending.size > 0 || this.timer === undefined) return;
        this.scheduler.cancel(this.timer);
        this.timer = undefined;
    }

    cancel(): void {
        if (this.timer !== undefined) this.scheduler.cancel(this.timer);
        this.timer = undefined;
        this.pending.clear();
        this.readyWhileRunning = false;
        this.generation++;
    }

    async whenIdle(): Promise<void> {
        while (this.running) await this.running;
    }

    private startDrain(): void {
        if (this.running) {
            this.readyWhileRunning = true;
            return;
        }
        if (this.pending.size === 0) return;
        const entries: RenameRepairEntry[] = [];
        for (const [file, entry] of this.pending) {
            if (!this.canRepair(file)) continue;
            entries.push(entry);
            this.pending.delete(file);
        }
        if (entries.length === 0) {
            this.scheduleDrain();
            return;
        }
        const generation = this.generation;
        this.running = this.runRepair(entries, generation);
    }

    private async runRepair(entries: readonly RenameRepairEntry[], generation: number): Promise<void> {
        try {
            await this.repair(entries);
        } catch (error: unknown) {
            console.error('[ImageManager] External rename repair failed:', error);
        } finally {
            this.running = null;
            if (generation === this.generation) {
                if (this.readyWhileRunning) {
                    this.readyWhileRunning = false;
                    this.startDrain();
                } else if (this.pending.size > 0 && this.timer === undefined) {
                    this.scheduleDrain();
                }
            }
        }
    }

    private scheduleDrain(): void {
        if (this.timer !== undefined) return;
        this.timer = this.scheduler.schedule(this.delay, () => {
            this.timer = undefined;
            this.startDrain();
        });
    }
}
