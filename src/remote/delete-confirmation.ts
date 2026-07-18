/** Final user acknowledgement gate for a destructive remote delete batch. */
export function canConfirmRemoteDelete(input: string, count: number, acknowledged: boolean): boolean {
    return acknowledged && input.trim() === String(count);
}
