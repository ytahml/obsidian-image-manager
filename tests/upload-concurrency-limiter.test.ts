import { describe, expect, it } from 'vitest';
import { UploadConcurrencyLimiter } from '../src/lifecycle/upload-concurrency-limiter';

describe('UploadConcurrencyLimiter', () => {
    it('allows at most two upload tasks to run at once', async () => {
        const limiter = new UploadConcurrencyLimiter(2);
        const started: number[] = [];
        const release: Array<() => void> = [];
        let resolveThirdStarted!: () => void;
        const thirdStarted = new Promise<void>((resolve) => { resolveThirdStarted = resolve; });

        const task = (id: number) => limiter.run(async () => {
            started.push(id);
            if (id === 3) resolveThirdStarted();
            await new Promise<void>((resolve) => release.push(resolve));
        });

        const first = task(1);
        const second = task(2);
        const third = task(3);
        await Promise.resolve();

        expect(started).toEqual([1, 2]);
        release.shift()!();
        await thirdStarted;
        expect(started).toEqual([1, 2, 3]);

        release.shift()!();
        release.shift()!();
        await Promise.all([first, second, third]);
    });
});
