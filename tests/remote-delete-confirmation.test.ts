import { describe, expect, it } from 'vitest';
import { canConfirmRemoteDelete } from '../src/remote/delete-confirmation';

describe('remote delete confirmation', () => {
    it('requires both the exact count and the irreversible-delete acknowledgement', () => {
        expect(canConfirmRemoteDelete('3', 3, false)).toBe(false);
        expect(canConfirmRemoteDelete('2', 3, true)).toBe(false);
        expect(canConfirmRemoteDelete(' 3 ', 3, true)).toBe(true);
    });
});
