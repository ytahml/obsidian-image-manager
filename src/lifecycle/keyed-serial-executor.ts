/** Serializes effects per key without blocking work for unrelated keys. */
export class KeyedSerialExecutor {
    private readonly tails = new Map<string, Promise<void>>();

    async run<T>(key: string, work: () => Promise<T>): Promise<T> {
        const previous = this.tails.get(key) ?? Promise.resolve();
        let release!: () => void;
        const current = new Promise<void>((resolve) => { release = resolve; });
        const tail = previous.catch(() => undefined).then(() => current);
        this.tails.set(key, tail);
        await previous.catch(() => undefined);
        try {
            return await work();
        } finally {
            release();
            if (this.tails.get(key) === tail) this.tails.delete(key);
        }
    }
}
