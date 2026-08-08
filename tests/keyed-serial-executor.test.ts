import { describe, expect, it } from 'vitest';
import { KeyedSerialExecutor } from '../src/lifecycle/keyed-serial-executor';

describe('KeyedSerialExecutor', () => {
    it('serializes effects for one source note while allowing another note to progress', async () => {
        const executor = new KeyedSerialExecutor();
        const events: string[] = [];
        let releaseFirst!: () => void;
        const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });

        const first = executor.run('note-a.md', async () => {
            events.push('a1-start');
            await firstGate;
            events.push('a1-end');
        });
        const second = executor.run('note-a.md', async () => { events.push('a2'); });
        const other = executor.run('note-b.md', async () => { events.push('b1'); });

        await other;
        expect(events).toEqual(['a1-start', 'b1']);
        releaseFirst();
        await Promise.all([first, second]);
        expect(events).toEqual(['a1-start', 'b1', 'a1-end', 'a2']);
    });
});
