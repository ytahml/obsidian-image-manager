import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("obsidian", () => ({
    Modal: class Modal {},
    Notice: class Notice {},
    TFile: class TFile {},
}));
vi.mock("../src/i18n", () => ({ t: (key: string) => key }));
vi.mock("../src/utils/image-scanner", () => ({ ImageScanner: class ImageScanner {} }));
vi.mock("../src/utils/path-utils", () => ({ formatFileSize: vi.fn() }));
vi.mock("../src/utils/local-orphan-management", () => ({}));
vi.mock("../src/modals/confirm-dialog", () => ({ ConfirmDialog: class ConfirmDialog {} }));
vi.mock("../src/modals/image-preview-modal", () => ({ ImagePreviewModal: class ImagePreviewModal {} }));
vi.mock("../src/modals/remote-image-browser", () => ({
    RemoteImageBrowserView: class RemoteImageBrowserView {},
}));

import { ImageBrowserModal } from "../src/modals/image-browser";

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
        const browser = Object.create(ImageBrowserModal.prototype) as SearchHarness;
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
