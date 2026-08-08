import { describe, expect, it, vi } from 'vitest';
import { ExternalRenameRepairCoordinator } from '../src/lifecycle/external-rename-repair-coordinator';

function scheduler() {
    const tasks: Array<() => void> = [];
    return {
        schedule: (_delay: number, callback: () => void) => { tasks.push(callback); return tasks.length - 1; },
        cancel: (id: number) => { tasks[id] = () => undefined; },
        runAll: () => { while (tasks.length > 0) tasks.shift()?.(); },
        runNext: () => tasks.shift()?.(),
    };
}

describe('ExternalRenameRepairCoordinator', () => {
    it('coalesces a rename chain to its original and final path in one batch', async () => {
        const timers = scheduler();
        const repair = vi.fn(async () => undefined);
        const coordinator = new ExternalRenameRepairCoordinator<object>(timers, repair);
        const file = {};

        coordinator.observe(file, 'a.png', 'b.png');
        coordinator.observe(file, 'b.png', 'c.png');
        timers.runAll();
        await coordinator.whenIdle();

        expect(repair).toHaveBeenCalledTimes(1);
        expect(repair).toHaveBeenCalledWith([{ oldPath: 'a.png', newPath: 'c.png' }]);
    });

    it('never overlaps repair batches', async () => {
        const timers = scheduler();
        let release!: () => void;
        const gate = new Promise<void>((resolve) => { release = resolve; });
        const repair = vi.fn()
            .mockImplementationOnce(async () => gate)
            .mockResolvedValue(undefined);
        const coordinator = new ExternalRenameRepairCoordinator<object>(timers, repair);

        coordinator.observe({}, 'a.png', 'b.png');
        timers.runAll();
        coordinator.observe({}, 'x.png', 'y.png');
        timers.runAll();
        expect(repair).toHaveBeenCalledTimes(1);
        release();
        await coordinator.whenIdle();
        expect(repair).toHaveBeenCalledTimes(2);
    });

    it('waits for the new quiet window when a rename arrives during an active repair', async () => {
        const timers = scheduler();
        let release!: () => void;
        const gate = new Promise<void>((resolve) => { release = resolve; });
        const repair = vi.fn()
            .mockImplementationOnce(async () => gate)
            .mockResolvedValue(undefined);
        const coordinator = new ExternalRenameRepairCoordinator<object>(timers, repair);

        coordinator.observe({}, 'a.png', 'b.png');
        timers.runAll();
        coordinator.observe({}, 'x.png', 'y.png');
        release();
        await coordinator.whenIdle();

        expect(repair).toHaveBeenCalledTimes(1);
        timers.runAll();
        await coordinator.whenIdle();
        expect(repair).toHaveBeenCalledTimes(2);
    });

    it('defers a batch until the transaction and protection gate allows repair', async () => {
        const timers = scheduler();
        const repair = vi.fn(async () => undefined);
        let allowed = false;
        const coordinator = new ExternalRenameRepairCoordinator<object>(
            timers,
            repair,
            2_000,
            () => allowed
        );

        coordinator.observe({}, 'a.png', 'b.png');
        timers.runNext();
        expect(repair).not.toHaveBeenCalled();

        allowed = true;
        timers.runNext();
        await coordinator.whenIdle();
        expect(repair).toHaveBeenCalledWith([{ oldPath: 'a.png', newPath: 'b.png' }]);
    });

    it('forgets a pending rename when its target file is deleted', () => {
        const timers = scheduler();
        const repair = vi.fn(async () => undefined);
        const coordinator = new ExternalRenameRepairCoordinator<object>(timers, repair);
        const file = {};

        coordinator.observe(file, 'a.png', 'b.png');
        coordinator.forget(file);
        timers.runAll();

        expect(repair).not.toHaveBeenCalled();
    });

    it('contains repair failures and becomes idle again', async () => {
        const timers = scheduler();
        const error = new Error('scan failed');
        const warn = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        const coordinator = new ExternalRenameRepairCoordinator<object>(
            timers,
            vi.fn().mockRejectedValue(error)
        );

        coordinator.observe({}, 'a.png', 'b.png');
        timers.runAll();
        await coordinator.whenIdle();

        expect(warn).toHaveBeenCalledWith('[ImageManager] External rename repair failed:', error);
        warn.mockRestore();
    });
});
