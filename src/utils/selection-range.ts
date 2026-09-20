export interface SelectionGestureOptions {
    orderedIds: readonly string[];
    eligibleIds: ReadonlySet<string>;
    selectedIds: ReadonlySet<string>;
    anchorId: string | null;
    targetId: string;
    checked: boolean;
    shiftKey: boolean;
}

type CardClick = Pick<
    MouseEvent,
    "button" | "detail" | "ctrlKey" | "metaKey" | "shiftKey"
>;

/** Card clicks toggle, including Ctrl/Cmd; Ctrl/Cmd + Shift keeps range additions. */
export function getCardSelectionChecked(
    event: CardClick,
    selected: boolean,
): boolean | undefined {
    if (event.button !== 0 || event.detail > 1) return undefined;
    return event.shiftKey && (event.ctrlKey || event.metaKey)
        ? true
        : !selected;
}

/** One handler per card. The native second click undoes only the first click's
 * selection effect before dblclick opens the preview. No guessed double-click
 * timeout or delayed work survives a search redraw, tab switch, or close.
 */
export function createCardSelectionHandler(options: {
    isSelected: () => boolean;
    // The adapter returns a live-validated undo for the entire gesture, including its anchor.
    onSelectionChange: (checked: boolean, shiftKey: boolean) => () => void;
}): (event: CardClick) => void {
    let undoClick: (() => void) | undefined;
    return (event) => {
        if (event.button !== 0) return;
        if (event.detail === 2) {
            const undo = undoClick;
            undoClick = undefined;
            undo?.();
            return;
        }
        const checked = getCardSelectionChecked(event, options.isSelected());
        if (checked === undefined) return;
        const undo = options.onSelectionChange(checked, event.shiftKey);
        undoClick = event.detail === 1 ? undo : undefined;
    };
}

/** Capture only the IDs changed by a gesture, not a replacement selection snapshot. */
export function createSelectionUndo(
    before: ReadonlySet<string>,
    after: ReadonlySet<string>,
): (
    current: ReadonlySet<string>,
    canRestore: (id: string) => boolean,
) => Set<string> {
    const added = [...after].filter((id) => !before.has(id));
    const removed = [...before].filter((id) => !after.has(id));
    return (current, canRestore) => {
        const restored = new Set(current);
        for (const id of added) restored.delete(id);
        for (const id of removed) {
            if (canRestore(id)) restored.add(id);
        }
        return restored;
    };
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
