import { describe, expect, it } from 'vitest';
import { IndeterminateImageRegistry } from '../src/lifecycle/indeterminate-image-registry';

function scheduler() {
    const tasks: Array<() => void> = [];
    const delays: number[] = [];
    return {
        schedule: (delay: number, callback: () => void) => { delays.push(delay); tasks.push(callback); return tasks.length - 1; },
        cancel: (id: number) => { tasks[id] = () => undefined; },
        runNext: () => tasks.shift()?.(),
        delays,
    };
}

describe('IndeterminateImageRegistry', () => {
    it('keeps an image indeterminate while active and for two seconds after the last owner ends', () => {
        const timers = scheduler();
        const registry = new IndeterminateImageRegistry<object>(timers);
        const file = {};
        registry.begin(file, 'a.png');
        registry.begin(file, 'a.png');
        registry.end(file, 'a.png');
        expect(registry.paths()).toEqual(new Set(['a.png']));
        registry.end(file, 'a.png');
        expect(registry.paths()).toEqual(new Set(['a.png']));
        expect(timers.delays).toEqual([2_000]);
        timers.runNext();
        expect(registry.paths()).toEqual(new Set());
    });

    it('moves and restarts protection per image without blocking another image', () => {
        const timers = scheduler();
        const registry = new IndeterminateImageRegistry<object>(timers);
        const first = {};
        const second = {};
        registry.touch(first, 'a.png');
        registry.touch(first, 'moved/a.png');
        registry.touch(second, 'b.png');
        expect(registry.paths()).toEqual(new Set(['moved/a.png', 'b.png']));
        timers.runNext();
        expect(registry.paths()).toEqual(new Set(['moved/a.png', 'b.png']));
        timers.runNext();
        expect(registry.paths()).toEqual(new Set(['b.png']));
    });

    it('cancels pending expiry work and clears every protection on unload', () => {
        const timers = scheduler();
        const registry = new IndeterminateImageRegistry<object>(timers);
        const file = {};
        registry.touch(file, 'a.png');

        registry.clear();
        timers.runNext();

        expect(registry.paths()).toEqual(new Set());
    });
});
