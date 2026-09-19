import { describe, expect, it } from "vitest";
import { applySelectionGesture } from "../src/utils/selection-range";

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
