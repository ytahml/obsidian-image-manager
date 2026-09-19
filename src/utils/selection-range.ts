export interface SelectionGestureOptions {
    orderedIds: readonly string[];
    eligibleIds: ReadonlySet<string>;
    selectedIds: ReadonlySet<string>;
    anchorId: string | null;
    targetId: string;
    checked: boolean;
    shiftKey: boolean;
}

export interface SelectionGestureResult {
    selectedIds: Set<string>;
    anchorId: string | null;
    rangeApplied: boolean;
}

/**
 * Applies one checkbox selection gesture against the complete current result order.
 * A valid Shift gesture keeps the original anchor; ordinary or invalid-range gestures
 * update the anchor to the target. Items outside the range are preserved.
 */
export function applySelectionGesture(
    options: SelectionGestureOptions,
): SelectionGestureResult {
    const selectedIds = new Set(options.selectedIds);
    if (!options.eligibleIds.has(options.targetId)) {
        return {
            selectedIds,
            anchorId: options.anchorId,
            rangeApplied: false,
        };
    }

    const anchorIndex =
        options.anchorId === null
            ? -1
            : options.orderedIds.indexOf(options.anchorId);
    const targetIndex = options.orderedIds.indexOf(options.targetId);
    const canApplyRange =
        options.shiftKey &&
        options.anchorId !== null &&
        options.eligibleIds.has(options.anchorId) &&
        anchorIndex >= 0 &&
        targetIndex >= 0;

    if (!canApplyRange) {
        updateSelection(selectedIds, options.targetId, options.checked);
        return {
            selectedIds,
            anchorId: options.targetId,
            rangeApplied: false,
        };
    }

    const start = Math.min(anchorIndex, targetIndex);
    const end = Math.max(anchorIndex, targetIndex);
    for (let index = start; index <= end; index++) {
        const id = options.orderedIds[index];
        if (id !== undefined && options.eligibleIds.has(id)) {
            updateSelection(selectedIds, id, options.checked);
        }
    }
    return {
        selectedIds,
        anchorId: options.anchorId,
        rangeApplied: true,
    };
}

function updateSelection(
    selectedIds: Set<string>,
    id: string,
    checked: boolean,
): void {
    if (checked) selectedIds.add(id);
    else selectedIds.delete(id);
}
