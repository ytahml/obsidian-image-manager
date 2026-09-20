import { describe, expect, it } from "vitest";
import {
    applySelectionGesture,
    createCardSelectionHandler,
    createSelectionUndo,
    getCardSelectionChecked,
} from "../src/utils/selection-range";

describe("getCardSelectionChecked", () => {
    const click = {
        button: 0,
        detail: 1,
        ctrlKey: false,
        metaKey: false,
        shiftKey: false,
    };

    it("toggles an ordinary independent click", () => {
        expect(getCardSelectionChecked(click, false)).toBe(true);
        expect(getCardSelectionChecked(click, true)).toBe(false);
    });

    it.each(["ctrlKey", "metaKey"] as const)(
        "toggles the target with %s while preserving additive Shift ranges",
        (modifier) => {
            const event = { ...click, [modifier]: true };
            expect(getCardSelectionChecked(event, false)).toBe(true);
            expect(getCardSelectionChecked(event, true)).toBe(false);
            expect(
                getCardSelectionChecked({ ...event, shiftKey: true }, true),
            ).toBe(true);
        },
    );

    it("ignores subsequent clicks in a multi-click sequence and non-primary buttons", () => {
        for (const detail of [2, 3]) {
            expect(
                getCardSelectionChecked(
                    { ...click, detail, ctrlKey: true },
                    true,
                ),
            ).toBeUndefined();
        }
        for (const button of [1, 2]) {
            expect(
                getCardSelectionChecked({ ...click, button }, false),
            ).toBeUndefined();
        }
    });

    it("passes the gesture through existing eligibility and preserves hidden selections", () => {
        const checked = getCardSelectionChecked(click, false);
        expect(checked).toBe(true);
        const result = apply({
            selectedIds: new Set(["hidden"]),
            targetId: "c",
            checked,
        });
        expect([...result.selectedIds]).toEqual(["hidden"]);
    });
});

describe("createCardSelectionHandler", () => {
    const click = {
        button: 0,
        detail: 1,
        ctrlKey: false,
        metaKey: false,
        shiftKey: false,
    };

    it.each([false, true])(
        "restores pre-double-click selection (%s) and the prior anchor",
        (initial) => {
            for (const modifier of [{}, { ctrlKey: true }, { metaKey: true }]) {
                let selected = initial;
                let anchor: string | null = "other-card";
                const handle = createCardSelectionHandler({
                    isSelected: () => selected,
                    onSelectionChange: (checked) => {
                        const previous = { selected, anchor };
                        selected = checked;
                        anchor = "target";
                        return () => {
                            selected = previous.selected;
                            anchor = previous.anchor;
                        };
                    },
                });
                handle({ ...click, ...modifier });
                handle({ ...click, ...modifier, detail: 2 });
                expect(selected).toBe(initial);
                expect(anchor).toBe("other-card");
                handle({ ...click, ...modifier, detail: 3 });
                expect(selected).toBe(initial);
                expect(anchor).toBe("other-card");
            }
        },
    );

    it("treats a later detail=1 click as a new toggle, not a double click", () => {
        let selected = false;
        const handle = createCardSelectionHandler({
            isSelected: () => selected,
            onSelectionChange: (checked) => {
                const previous = selected;
                selected = checked;
                return () => {
                    selected = previous;
                };
            },
        });
        handle(click);
        expect(selected).toBe(true);
        handle(click);
        expect(selected).toBe(false);
        handle({ ...click, ctrlKey: true });
        expect(selected).toBe(true);
        handle({ ...click, ctrlKey: true });
        expect(selected).toBe(false);
    });

    it("does not invent a rollback without the first primary click", () => {
        const changes: boolean[] = [];
        const handle = createCardSelectionHandler({
            isSelected: () => false,
            onSelectionChange: (checked) => {
                changes.push(checked);
                return () => {};
            },
        });
        handle({ ...click, button: 2 });
        handle({ ...click, detail: 2 });
        expect(changes).toEqual([]);
    });
});

describe("selection gesture undo", () => {
    it("undoes only changed IDs, preserves unrelated changes, and rechecks restored eligibility", () => {
        const before = new Set(["keep", "removed", "now-ineligible"]);
        const after = new Set(["keep", "added"]);
        const undo = createSelectionUndo(before, after);
        // Snapshot differences must not change when caller-owned sets are mutated later.
        before.clear();
        after.add("later");
        const restored = undo(
            new Set(["keep", "added", "later"]),
            (id) => id !== "now-ineligible",
        );
        expect(restored).toEqual(new Set(["keep", "removed", "later"]));
    });

    it("forwards Shift to the range adapter and calls its undo for the second click", () => {
        let selected = new Set(["anchor"]);
        const handle = createCardSelectionHandler({
            isSelected: () => selected.has("target"),
            onSelectionChange: (checked, shiftKey) => {
                expect(checked).toBe(true);
                expect(shiftKey).toBe(true);
                const after = new Set(["anchor", "middle", "target"]);
                const undo = createSelectionUndo(selected, after);
                selected = after;
                return () => {
                    selected = undo(selected, () => true);
                };
            },
        });
        const event = {
            button: 0,
            detail: 1,
            ctrlKey: false,
            metaKey: false,
            shiftKey: true,
        };
        handle(event);
        expect(selected.size).toBe(3);
        handle({ ...event, detail: 2 });
        expect(selected).toEqual(new Set(["anchor"]));
    });
});

const orderedIds = ["a", "b", "c", "d", "e"];
const eligibleIds = new Set(["a", "b", "d", "e"]);

function apply(
    overrides: Partial<Parameters<typeof applySelectionGesture>[0]> = {},
) {
    return applySelectionGesture({
        orderedIds,
        eligibleIds,
        selectedIds: new Set<string>(),
        anchorId: null,
        targetId: "a",
        checked: true,
        shiftKey: false,
        ...overrides,
    });
}

describe("applySelectionGesture", () => {
    it("applies a normal checkbox gesture and records the target as the anchor", () => {
        const result = apply({ selectedIds: new Set(["e"]), targetId: "b" });

        expect([...result.selectedIds]).toEqual(["e", "b"]);
        expect(result.anchorId).toBe("b");
        expect(result.rangeApplied).toBe(false);
    });

    it("selects a forward range while skipping ineligible items", () => {
        const result = apply({
            selectedIds: new Set(["a"]),
            anchorId: "a",
            targetId: "d",
            shiftKey: true,
        });

        expect([...result.selectedIds]).toEqual(["a", "b", "d"]);
        expect(result.anchorId).toBe("a");
        expect(result.rangeApplied).toBe(true);
    });

    it("selects a reverse range and preserves selections outside it", () => {
        const result = apply({
            selectedIds: new Set(["a", "e"]),
            anchorId: "d",
            targetId: "b",
            shiftKey: true,
        });

        expect([...result.selectedIds]).toEqual(["a", "e", "b", "d"]);
        expect(result.anchorId).toBe("d");
        expect(result.rangeApplied).toBe(true);
    });

    it("clears an eligible range without changing selections outside it", () => {
        const result = apply({
            selectedIds: new Set(["a", "b", "d", "e"]),
            anchorId: "a",
            targetId: "d",
            checked: false,
            shiftKey: true,
        });

        expect([...result.selectedIds]).toEqual(["e"]);
        expect(result.anchorId).toBe("a");
    });

    it("falls back to a normal gesture when the anchor is absent from the current order", () => {
        const result = apply({
            selectedIds: new Set(["e"]),
            anchorId: "missing",
            targetId: "b",
            shiftKey: true,
        });

        expect([...result.selectedIds]).toEqual(["e", "b"]);
        expect(result.anchorId).toBe("b");
        expect(result.rangeApplied).toBe(false);
    });

    it("ignores a gesture targeting an ineligible item", () => {
        const result = apply({
            selectedIds: new Set(["a"]),
            anchorId: "a",
            targetId: "c",
            shiftKey: true,
        });

        expect([...result.selectedIds]).toEqual(["a"]);
        expect(result.anchorId).toBe("a");
        expect(result.rangeApplied).toBe(false);
    });
});
