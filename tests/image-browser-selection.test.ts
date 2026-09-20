import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CardElement } from "./helpers/card-dom";

const { previewOpen } = vi.hoisted(() => ({ previewOpen: vi.fn() }));

vi.mock("obsidian", () => ({
    Modal: class Modal {},
    Notice: class Notice {},
    TFile: class TFile {},
}));
vi.mock("../src/i18n", () => ({ t: (key: string) => key }));
vi.mock("../src/utils/image-scanner", () => ({
    ImageScanner: class ImageScanner {},
}));
vi.mock("../src/utils/path-utils", () => ({ formatFileSize: vi.fn() }));
vi.mock("../src/modals/confirm-dialog", () => ({
    ConfirmDialog: class ConfirmDialog {},
}));
vi.mock("../src/modals/image-preview-modal", () => ({
    ImagePreviewModal: class ImagePreviewModal {
        open = previewOpen;
    },
}));
vi.mock("../src/modals/remote-image-browser", () => ({
    RemoteImageBrowserView: class RemoteImageBrowserView {},
}));

import { ImageBrowserModal } from "../src/modals/image-browser";

type LocalCardHarness = {
    selectedPaths: Set<string>;
    orphanPaths: Set<string>;
    localScanState: string;
    localSelectionAnchorPath: string | null;
    searchInput: { value: string };
    applyFilterAndSort: () => void;
    filteredImages: { path: string; name: string; stat: { size: number } }[];
    renderGrid: () => void;
    clearLocalSelection: () => void;
};

function getCards(root: CardElement) {
    const [a, b, c, d] = root.querySelectorAll(".image-browser-card");
    if (!a || !b || !c || !d) throw new Error("Expected four local cards");
    return [a, b, c, d] as const;
}

function localCards() {
    const root = new CardElement();
    const files = ["a", "b", "referenced", "d"].map((id) => ({
        path: `${id}.png`,
        name: `${id}.png`,
        stat: { size: 10 },
    }));
    const browser = Object.assign(
        Object.create(ImageBrowserModal.prototype) as LocalCardHarness,
        {
            app: {
                vault: {
                    getResourcePath: (file: { path: string }) => file.path,
                },
            },
            plugin: {
                settings: {
                    thumbnailSize: 200,
                    localImageBrowserSort: { field: "name", order: "asc" },
                },
            },
            searchInput: { value: "" },
            referenceFilter: "all",
            scanner: {
                filterImages: (
                    images: typeof files,
                    filter: { keyword: string },
                ) =>
                    images.filter((file) => file.name.includes(filter.keyword)),
                sortImages: (images: typeof files) => images,
            },
            gridEl: root.asElement(),
            filteredImages: files,
            allImages: files,
            orphanPaths: new Set(["a.png", "b.png", "d.png"]),
            indeterminatePaths: new Set<string>(),
            localScanState: "ready",
            selectedPaths: new Set(["hidden.png"]),
            localSelectionAnchorPath: null,
            localSelectionControls: new Map(),
        },
    );
    browser.renderGrid();
    return { browser, root, cards: getCards(root) };
}

describe("local production card events", () => {
    beforeEach(() => previewOpen.mockClear());

    it("toggles ordinary and Ctrl/Cmd clicks without clearing other choices", () => {
        const { browser, cards } = localCards();
        cards[0].find("img").fire("click");
        cards[1].find(".image-browser-card-name").fire("click");
        cards[0].fire("click");
        expect([...browser.selectedPaths]).toEqual(["hidden.png", "b.png"]);
        expect(cards[0].find("input").checked).toBe(false);
        expect(cards[0].classes.has("is-selected")).toBe(false);
        expect(previewOpen).not.toHaveBeenCalled();
        cards[0].fire("click", { ctrlKey: true });
        expect(browser.selectedPaths.has("a.png")).toBe(true);
        expect(cards[0].find("input").checked).toBe(true);
        expect(cards[0].classes.has("is-selected")).toBe(true);
        cards[0].fire("click", { metaKey: true });
        expect([...browser.selectedPaths]).toEqual(["hidden.png", "b.png"]);
        expect(cards[0].find("input").checked).toBe(false);
        expect(cards[0].classes.has("is-selected")).toBe(false);
    });

    it.each([false, true])(
        "double click previews without changing the initial selection (%s) or anchor",
        (selected) => {
            const { browser, cards } = localCards();
            if (selected) cards[0].find("input").fire("click");
            cards[1].fire("click");
            const before = new Set(browser.selectedPaths);
            const anchor = browser.localSelectionAnchorPath;
            for (const modifier of [{}, { ctrlKey: true }, { metaKey: true }]) {
                cards[0].doubleClick(modifier);
                expect(browser.selectedPaths).toEqual(before);
                expect(browser.localSelectionAnchorPath).toBe(anchor);
                expect(cards[0].find("input").checked).toBe(selected);
                expect(cards[0].classes.has("is-selected")).toBe(selected);
            }
            expect(previewOpen).toHaveBeenCalledTimes(3);
        },
    );

    it("keeps referenced and scan-unready images unselectable but previewable", () => {
        const { browser, cards, root } = localCards();
        cards[2].doubleClick();
        expect(browser.selectedPaths.has("referenced.png")).toBe(false);
        expect(cards[2].querySelector("input")).toBeNull();
        expect(previewOpen).toHaveBeenCalledTimes(1);
        browser.localScanState = "scanning";
        browser.renderGrid();
        root.find(".image-browser-card").fire("click");
        expect([...browser.selectedPaths]).toEqual(["hidden.png"]);
    });

    it("isolates checkbox labels and preserves Shift range selection and cancellation", () => {
        const { browser, cards } = localCards();
        cards[0].find("label").fire("click");
        cards[3].find("input").fire("click", { shiftKey: true });
        expect([...browser.selectedPaths]).toEqual([
            "hidden.png",
            "a.png",
            "b.png",
            "d.png",
        ]);
        cards[3].find("input").fire("click", { shiftKey: true });
        expect([...browser.selectedPaths]).toEqual(["hidden.png"]);
        cards[0].find("label").doubleClick();
        expect(previewOpen).not.toHaveBeenCalled();
        expect(browser.selectedPaths.has("a.png")).toBe(false);
    });

    it.each([
        [0, 3],
        [3, 0],
    ] as const)(
        "Shift-clicks card range %s to %s, skipping ineligible images",
        (start, end) => {
            const { browser, cards } = localCards();
            cards[start].fire("click");
            const anchor = browser.localSelectionAnchorPath;
            cards[end].fire("click", { shiftKey: true });
            expect(browser.selectedPaths).toEqual(
                new Set(["hidden.png", "a.png", "b.png", "d.png"]),
            );
            expect(browser.localSelectionAnchorPath).toBe(anchor);
            cards[end].fire("click", { shiftKey: true });
            expect(browser.selectedPaths).toEqual(new Set(["hidden.png"]));
            expect(browser.localSelectionAnchorPath).toBe(anchor);
            expect(previewOpen).not.toHaveBeenCalled();
        },
    );

    it.each([false, true])(
        "Shift double-click restores a mixed range (target selected: %s)",
        (selectedTarget) => {
            const { browser, cards } = localCards();
            if (selectedTarget) cards[3].fire("click");
            cards[0].fire("click");
            const before = new Set(browser.selectedPaths);
            const anchor = browser.localSelectionAnchorPath;
            cards[3].doubleClick({ shiftKey: true });
            expect(browser.selectedPaths).toEqual(before);
            expect(browser.localSelectionAnchorPath).toBe(anchor);
            expect(cards[1].find("input").checked).toBe(false);
            expect(previewOpen).toHaveBeenCalledTimes(1);
        },
    );

    it("does not restore range members that have lost orphan eligibility", () => {
        const { browser, cards } = localCards();
        cards[3].fire("click");
        cards[0].fire("click");
        cards[3].fire("click", { shiftKey: true, detail: 1 });
        browser.orphanPaths.delete("a.png");
        cards[3].fire("click", { shiftKey: true, detail: 2 });
        expect(browser.selectedPaths).toEqual(new Set(["hidden.png", "d.png"]));
    });

    it("offers a touch/keyboard preview button isolated from card selection", () => {
        const { browser, cards } = localCards();
        const preview = cards[0].find("button");
        preview.doubleClick();
        expect(previewOpen).toHaveBeenCalledTimes(1);
        preview.fire("click", { detail: 0 });
        expect(previewOpen).toHaveBeenCalledTimes(2);
        expect([...browser.selectedPaths]).toEqual(["hidden.png"]);
    });

    it.each(["ctrlKey", "metaKey"] as const)(
        "adds a new item with %s while preserving prior and hidden choices",
        (modifier) => {
            const { browser, cards } = localCards();
            cards[0].fire("click", { [modifier]: true });
            cards[1].fire("click", { [modifier]: true });
            expect([...browser.selectedPaths]).toEqual([
                "hidden.png",
                "a.png",
                "b.png",
            ]);
            cards[0].fire("click", { [modifier]: true });
            expect([...browser.selectedPaths]).toEqual(["hidden.png", "b.png"]);
            expect(cards[0].find("input").checked).toBe(false);
            expect(cards[0].classes.has("is-selected")).toBe(false);
            cards[0].fire("click", { [modifier]: true });
            expect(browser.selectedPaths).toEqual(
                new Set(["hidden.png", "a.png", "b.png"]),
            );
            expect(cards[0].find("input").checked).toBe(true);
            expect(cards[0].classes.has("is-selected")).toBe(true);
        },
    );

    it("clears the anchor when search results update but keeps prior selections", () => {
        const { browser, cards, root } = localCards();
        cards[0].fire("click");
        expect(browser.localSelectionAnchorPath).toBe("a.png");
        browser.searchInput.value = "b.png";
        browser.applyFilterAndSort();
        expect(browser.localSelectionAnchorPath).toBeNull();
        expect([...browser.selectedPaths]).toEqual(["hidden.png", "a.png"]);
        expect(root.querySelectorAll(".image-browser-card")).toHaveLength(1);
        root.find(".image-browser-card").fire("click", { shiftKey: true });
        expect([...browser.selectedPaths]).toEqual([
            "hidden.png",
            "a.png",
            "b.png",
        ]);
        expect(browser.localSelectionAnchorPath).toBe("b.png");
    });

    it("preserves selection through redraw and clears hidden items explicitly", () => {
        const { browser, cards, root } = localCards();
        cards[0].fire("click");
        browser.filteredImages = browser.filteredImages.slice().reverse();
        browser.renderGrid();
        const redrawn = getCards(root);
        expect(redrawn[3].find("input").checked).toBe(true);
        browser.clearLocalSelection();
        expect(browser.selectedPaths.size).toBe(0);
        expect(redrawn[3].find("input").checked).toBe(false);
    });
});

type SearchHarness = {
    localSelectionAnchorPath: string | null;
    debounceTimer: number | null;
    applyFilterAndSort: () => void;
    onSearchInput: () => void;
};

describe("ImageBrowserModal selection anchor", () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.stubGlobal("window", {
            setTimeout,
            clearTimeout,
        });
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.unstubAllGlobals();
    });

    it("clears an anchor created during the search debounce when results update", () => {
        const browser = Object.create(
            ImageBrowserModal.prototype,
        ) as SearchHarness;
        browser.localSelectionAnchorPath = "before-search.png";
        browser.debounceTimer = null;
        browser.applyFilterAndSort = vi.fn();

        browser.onSearchInput();
        expect(browser.localSelectionAnchorPath).toBeNull();

        browser.localSelectionAnchorPath = "clicked-during-debounce.png";
        vi.advanceTimersByTime(300);

        expect(browser.localSelectionAnchorPath).toBeNull();
        expect(browser.applyFilterAndSort).toHaveBeenCalledTimes(1);
    });
});
