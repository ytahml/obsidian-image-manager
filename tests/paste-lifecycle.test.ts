import { describe, expect, it, vi } from 'vitest';
import {
    PasteLifecycleCoordinator,
    type LifecycleScheduler,
} from '../src/lifecycle/paste-lifecycle';

function scheduler(): LifecycleScheduler & { runAll(): void } {
    const tasks: Array<{ delay: number; callback: () => void }> = [];
    return {
        schedule: (delay, callback) => {
            tasks.push({ delay, callback });
            return tasks.length - 1;
        },
        cancel: (id) => { if (tasks[id]) tasks[id].callback = () => {}; },
        runAll: () => {
            tasks.sort((a, b) => a.delay - b.delay);
            while (tasks.length > 0) tasks.shift()?.callback();
        },
    };
}

describe('PasteLifecycleCoordinator', () => {
    it('emits a handoff-ready item after a uniquely mapped weak convergence buffer', () => {
        const timers = scheduler();
        const ready = vi.fn();
        const coordinator = new PasteLifecycleCoordinator(timers, ready, vi.fn());
        const transaction = coordinator.start('note.md', 1);

        coordinator.observeCandidate(transaction, 0, 'file-1', 'attachments/a.png');
        coordinator.observeReference(transaction, 0, 'file-1', 'ref-1', false);

        expect(ready).not.toHaveBeenCalled();
        timers.runAll();
        expect(ready).toHaveBeenCalledWith(expect.objectContaining({
            notePath: 'note.md',
            fileId: 'file-1',
            referenceId: 'ref-1',
        }));
    });

    it('resets a pending handoff when a relevant mutation changes its mapping', () => {
        const timers = scheduler();
        const ready = vi.fn();
        const coordinator = new PasteLifecycleCoordinator(timers, ready, vi.fn());
        const transaction = coordinator.start('note.md', 1);

        coordinator.observeCandidate(transaction, 0, 'file-1', 'attachments/a.png');
        coordinator.observeReference(transaction, 0, 'file-1', 'ref-1', false);
        coordinator.invalidate(transaction, 0);
        coordinator.observeReference(transaction, 0, 'file-1', 'ref-2', true);

        timers.runAll();
        expect(ready).toHaveBeenCalledTimes(1);
        expect(ready).toHaveBeenCalledWith(expect.objectContaining({ referenceId: 'ref-2' }));
    });

    it('keeps pasted items independent and does not let unrelated transactions reset readiness', () => {
        const timers = scheduler();
        const ready = vi.fn();
        const coordinator = new PasteLifecycleCoordinator(timers, ready, vi.fn());
        const first = coordinator.start('note.md', 2);
        const unrelated = coordinator.start('other.md', 1);

        coordinator.observeCandidate(first, 0, 'file-1', 'attachments/a.png');
        coordinator.observeCandidate(first, 1, 'file-2', 'attachments/b.png');
        coordinator.observeReference(first, 0, 'file-1', 'ref-1', true);
        coordinator.observeReference(first, 1, 'file-2', 'ref-2', false);
        coordinator.observeCandidate(unrelated, 0, 'file-3', 'attachments/c.png');

        timers.runAll();
        expect(ready).toHaveBeenCalledTimes(2);
        expect(ready).toHaveBeenNthCalledWith(1, expect.objectContaining({ fileId: 'file-1' }));
        expect(ready).toHaveBeenNthCalledWith(2, expect.objectContaining({ fileId: 'file-2' }));
    });

    it('fails closed when a transaction reaches its hard timeout before a unique mapping', () => {
        const timers = scheduler();
        const cancelled = vi.fn();
        const coordinator = new PasteLifecycleCoordinator(timers, vi.fn(), cancelled);
        coordinator.start('note.md', 1);

        timers.runAll();
        expect(cancelled).toHaveBeenCalledWith(expect.objectContaining({ reason: 'timeout' }));
    });

    it('cancels all pending transactions on unload without emitting a handoff', () => {
        const timers = scheduler();
        const ready = vi.fn();
        const cancelled = vi.fn();
        const coordinator = new PasteLifecycleCoordinator(timers, ready, cancelled);
        const transaction = coordinator.start('note.md', 1);
        coordinator.observeCandidate(transaction, 0, 'file-1', 'attachments/a.png');
        coordinator.observeReference(transaction, 0, 'file-1', 'ref-1', true);

        coordinator.cancelAll('unload');
        timers.runAll();
        expect(ready).not.toHaveBeenCalled();
        expect(cancelled).toHaveBeenCalledWith(expect.objectContaining({ reason: 'unload' }));
    });
});
