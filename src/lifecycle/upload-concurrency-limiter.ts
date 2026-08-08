/** Limits in-flight upload work without coupling queue policy to Obsidian APIs. */
export class UploadConcurrencyLimiter {
    private active = 0;
    private readonly waiters: Array<() => void> = [];

    constructor(private readonly limit: number) {}

    async run<T>(work: () => Promise<T>): Promise<T> {
        await this.acquire();
        try {
            return await work();
        } finally {
            this.release();
        }
    }

    private async acquire(): Promise<void> {
        if (this.active < this.limit) {
            this.active++;
            return;
        }
        await new Promise<void>((resolve) => this.waiters.push(resolve));
        this.active++;
    }

    private release(): void {
        this.active--;
        this.waiters.shift()?.();
    }
}
