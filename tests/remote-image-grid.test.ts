import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CardElement, CardIntersectionObserver } from "./helpers/card-dom";
import type { ImageHostingConfig } from "../src/types";
import type { RemoteObjectProvider } from "../src/remote/provider";
import type { RemoteObject } from "../src/remote/types";
import type { RemoteDeleteEligibilityContext } from "../src/remote/delete-policy";

vi.mock("obsidian", () => ({
    Modal: class Modal {},
    Notice: class Notice {},
    requestUrl: vi.fn(() => {
        throw new Error("Unexpected provider request in grid tests");
    }),
}));
vi.mock("../src/i18n", () => ({ t: (key: string) => key }));
vi.mock("../src/utils/path-utils", () => ({ formatFileSize: () => "10 B" }));

import {
    RemoteImageGrid,
    type RemoteImageGridItem,
} from "../src/modals/remote-image-grid";
import { RemoteImageBrowserView } from "../src/modals/remote-image-browser";
import { RemoteDeleteSession } from "../src/remote/delete-session";
import { RemotePreviewSession } from "../src/remote/preview-session";
import { RemoteThumbnailSession } from "../src/remote/thumbnail-session";

type RemoteHarness = {
    imageGrid: RemoteImageGrid | null;
    remoteSelectionAnchorKey: string | null;
    keyword: string;
    renderPageResults: (
        config: ImageHostingConfig,
        container: HTMLElement,
    ) => void;
    applyRemoteSelectionGesture: (
        config: ImageHostingConfig,
        provider: RemoteObjectProvider,
        ordered: readonly RemoteObject[],
        eligible: readonly RemoteObject[],
        target: RemoteObject,
        checked: boolean,
        shift: boolean,
    ) => () => void;
};

function remoteCards(
    overrides: Partial<RemoteImageGridItem> = {},
    count = 3,
    deleteEnabled = true,
    ineligibleIndices: readonly number[] = [],
) {
    const root = new CardElement();
    const config: ImageHostingConfig = {
        id: "test",
        name: "Test",
        type: "s3",
        enabled: true,
        uploadPath: "",
        urlPrefix: "",
        config: {
            endpoint: "https://example.invalid",
            region: "auto",
            accessKeyId: "test",
            secretAccessKey: "test",
            bucket: "test",
            forcePathStyle: true,
        },
        remoteManagement: {
            enabled: true,
            prefix: "",
            previewAccess: "presigned",
            publicUrlAliases: [],
            pageSize: 100,
            previewMode: "viewport",
        },
    };
    const listObjects = vi.fn();
    const provider: RemoteObjectProvider = {
        capabilities: new Set(["list", "preview", "delete"]),
        listObjects,
        createPreviewUrl: vi.fn(),
        deleteObject: vi.fn(),
    };
    const items: RemoteImageGridItem[] = Array.from(
        { length: count },
        (_, index) => ({
            object: { hostingId: "test", key: `${index}.png`, size: 10 },
            referenceState: "not-referenced-in-current-vault",
            references: [],
            ...overrides,
            ...(ineligibleIndices.includes(index)
                ? {
                      referenceState: "referenced" as const,
                      deleteUnavailable: "referenced" as const,
                  }
                : {}),
        }),
    );
    const hidden: RemoteObject = {
        hostingId: "test",
        key: "hidden.png",
        size: 1,
    };
    const allObjects = [...items.map((item) => item.object), hidden];
    const context: RemoteDeleteEligibilityContext = {
        config,
        provider,
        scannedObjects: allObjects,
        classify: (object) =>
            items.find((item) => item.object === object)?.referenceState ??
            "not-referenced-in-current-vault",
        indexState: {
            status: "fresh",
            summary: {
                scannedAt: 123,
                markdownFileCount: 1,
                referencedCount: 0,
                possiblyReferencedCount: 0,
                unmappableCount: 0,
            },
        },
    };
    const selection = new RemoteDeleteSession();
    selection.setSelected(hidden, true, context);
    const failure = vi.fn();
    const browser: RemoteHarness = Object.assign(
        Object.create(RemoteImageBrowserView.prototype) as RemoteHarness,
        {
            deleteSession: selection,
            session: {
                getAllObjects: () => allObjects,
                getSnapshot: () => ({ status: "completed", pages: [{}] }),
            },
            remoteSelectionAnchorKey: null,
            keyword: "",
            getDeleteContext: () => context,
            updateDeleteToolbar: vi.fn(),
            showRemoteSelectionFailure: failure,
            imageGrid: null,
        },
    );
    const thumbnails = new RemoteThumbnailSession(new RemotePreviewSession());
    const enqueue = vi
        .spyOn(thumbnails, "enqueue")
        .mockImplementation(() => {});
    const preview = vi.fn();
    const selectionChange = vi.fn(
        (object: RemoteObject, checked: boolean, shift: boolean) => {
            return browser.applyRemoteSelectionGesture(
                config,
                provider,
                items.map((item) => item.object),
                items
                    .filter((item) => !item.deleteUnavailable)
                    .map((item) => item.object),
                object,
                checked,
                shift,
            );
        },
    );
    const grid = new RemoteImageGrid({
        container: root.asElement(),
        provider,
        items,
        deleteEnabled,
        thumbnailSession: thumbnails,
        isSelected: (object) => selection.isSelected(object),
        onSelectionChange: selectionChange,
        onPreview: preview,
        onImageRequest: vi.fn(),
        previewUnavailableMessage: (reason) => reason,
        deleteUnavailableMessage: (reason) => reason,
    });
    browser.imageGrid = grid;
    const card = (index: number) => {
        const element = root.querySelectorAll(".remote-image-card")[index];
        if (!element) throw new Error(`Missing remote card ${index}`);
        return element;
    };
    const selectedKeys = () =>
        selection.getSelectedObjects().map((object) => object.key);
    return {
        root,
        grid,
        card,
        context,
        selectedKeys,
        preview,
        enqueue,
        provider,
        listObjects,
        failure,
        selectionChange,
        browser,
        thumbnails,
        config,
    };
}

describe("remote production grid and selection adapter", () => {
    beforeEach(() => {
        CardIntersectionObserver.instances = [];
        vi.stubGlobal("IntersectionObserver", CardIntersectionObserver);
    });
    afterEach(() => {
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    it("toggles ordinary and Ctrl/Cmd clicks without network calls", () => {
        const h = remoteCards();
        h.card(0).find(".remote-image-card-media").fire("click");
        h.card(1).find(".remote-image-card-name").fire("click");
        h.card(0).fire("click");
        expect(h.selectedKeys()).toEqual(["hidden.png", "1.png"]);
        expect(h.card(0).find("input").checked).toBe(false);
        expect(h.card(0).classes.has("is-selected")).toBe(false);
        h.card(0).fire("click", { ctrlKey: true });
        expect(h.card(0).find("input").checked).toBe(true);
        expect(h.card(0).classes.has("is-selected")).toBe(true);
        h.card(0).fire("click", { metaKey: true });
        expect(h.selectedKeys()).toEqual(["hidden.png", "1.png"]);
        expect(h.card(0).find("input").checked).toBe(false);
        expect(h.card(0).classes.has("is-selected")).toBe(false);
        expect(h.preview).not.toHaveBeenCalled();
        expect(h.enqueue).not.toHaveBeenCalled();
        expect(h.listObjects).not.toHaveBeenCalled();
        expect(h.provider.createPreviewUrl).not.toHaveBeenCalled();
        expect(h.provider.deleteObject).not.toHaveBeenCalled();
    });

    it.each(["ctrlKey", "metaKey"] as const)(
        "adds new items with %s while retaining prior and hidden choices",
        (modifier) => {
            const h = remoteCards();
            h.card(0).fire("click", { [modifier]: true });
            h.card(1).fire("click", { [modifier]: true });
            expect(h.selectedKeys()).toEqual(["hidden.png", "0.png", "1.png"]);
            h.card(0).fire("click", { [modifier]: true });
            expect(h.selectedKeys()).toEqual(["hidden.png", "1.png"]);
            expect(h.card(0).find("input").checked).toBe(false);
            expect(h.card(0).classes.has("is-selected")).toBe(false);
            h.card(0).fire("click", { [modifier]: true });
            expect(new Set(h.selectedKeys())).toEqual(
                new Set(["hidden.png", "0.png", "1.png"]),
            );
            expect(h.card(0).find("input").checked).toBe(true);
            expect(h.card(0).classes.has("is-selected")).toBe(true);
        },
    );

    it("clears the anchor at the production search-results boundary without clearing selection", () => {
        const h = remoteCards();
        h.card(0).fire("click");
        expect(h.browser.remoteSelectionAnchorKey).toBe("0.png");
        Object.assign(h.browser, {
            thumbnailSession: h.thumbnails,
            referenceFilter: "all",
            plugin: {
                settings: {
                    remoteImageBrowserSort: { field: "key", order: "asc" },
                    supportedExtensions: ["png"],
                },
                remoteReferenceIndex: {
                    createLookup: () => ({
                        classify: h.context.classify,
                        getReferences: () => [],
                    }),
                    getState: () => h.context.indexState,
                },
            },
        });
        h.browser.keyword = "2.png";
        h.browser.renderPageResults(h.config, h.root.asElement());
        expect(h.browser.remoteSelectionAnchorKey).toBeNull();
        expect(h.selectedKeys()).toEqual(["hidden.png", "0.png"]);
        expect(h.root.querySelectorAll(".remote-image-card")).toHaveLength(1);
        h.card(0).fire("click", { shiftKey: true });
        expect(h.selectedKeys()).toEqual(["hidden.png", "0.png", "2.png"]);
        expect(h.browser.remoteSelectionAnchorKey).toBe("2.png");
        expect(h.listObjects).not.toHaveBeenCalled();
        expect(h.enqueue).not.toHaveBeenCalled();
        h.browser.imageGrid?.destroy();
    });

    it.each([false, true])(
        "double click previews without changing the initial selection (%s) or anchor",
        (selected) => {
            const h = remoteCards();
            if (selected) h.card(0).find("input").fire("click");
            h.card(1).fire("click");
            const before = new Set(h.selectedKeys());
            const anchor = h.browser.remoteSelectionAnchorKey;
            for (const modifier of [{}, { ctrlKey: true }, { metaKey: true }]) {
                h.card(0).doubleClick(modifier);
                expect(new Set(h.selectedKeys())).toEqual(before);
                expect(h.browser.remoteSelectionAnchorKey).toBe(anchor);
                expect(h.card(0).find("input").checked).toBe(selected);
                expect(h.card(0).classes.has("is-selected")).toBe(selected);
            }
            expect(h.preview).toHaveBeenCalledTimes(3);
        },
    );

    it.each(["referenced", "index-stale", "unmappable"] as const)(
        "does not select a %s card but keeps preview available",
        (reason) => {
            const h = remoteCards({ deleteUnavailable: reason });
            h.card(0).doubleClick();
            expect(h.selectedKeys()).toEqual(["hidden.png"]);
            expect(h.selectionChange).not.toHaveBeenCalled();
            expect(h.card(0).querySelector("input")).toBeNull();
            expect(h.preview).toHaveBeenCalledTimes(1);
        },
    );

    it("preserves the disabled-delete and unavailable-preview boundaries independently", () => {
        const h = remoteCards({}, 3, false);
        h.card(0).doubleClick();
        expect(h.selectedKeys()).toEqual(["hidden.png"]);
        expect(h.preview).toHaveBeenCalledTimes(1);
        const unavailable = remoteCards({ previewUnavailable: "not-image" });
        unavailable.card(0).doubleClick();
        expect(unavailable.preview).not.toHaveBeenCalled();
        expect(unavailable.card(0).querySelector("button")).toBeNull();
        expect(unavailable.selectedKeys()).toEqual(["hidden.png"]);
        unavailable.card(0).fire("click");
        expect(unavailable.selectedKeys()).toContain("0.png");
    });

    it("revalidates current index eligibility even when the rendered card is stale", () => {
        const h = remoteCards();
        if (h.context.indexState.status !== "fresh")
            throw new Error("Expected fresh fixture");
        h.context.indexState = {
            status: "stale",
            summary: h.context.indexState.summary,
        };
        h.card(0).fire("click");
        expect(h.selectedKeys()).toEqual(["hidden.png"]);
        expect(h.failure).toHaveBeenCalledWith("index-stale");
        expect(h.card(0).find("input").checked).toBe(false);
    });

    it("does not bypass fresh-index eligibility when restoring a double-click selection", () => {
        const h = remoteCards();
        h.card(0).fire("click");
        h.card(0).fire("click", { detail: 1 });
        expect(h.selectedKeys()).not.toContain("0.png");
        if (h.context.indexState.status !== "fresh")
            throw new Error("Expected fresh fixture");
        h.context.indexState = {
            status: "stale",
            summary: h.context.indexState.summary,
        };
        h.card(0).fire("click", { detail: 2 });
        expect(h.selectedKeys()).not.toContain("0.png");
        expect(h.failure).toHaveBeenCalledWith("index-stale");
    });

    it("does not restore a Shift-click range after the reference index becomes stale", () => {
        const h = remoteCards({}, 4);
        h.card(3).fire("click");
        h.card(0).fire("click");
        h.card(3).fire("click", { shiftKey: true, detail: 1 });
        expect(h.selectedKeys()).toEqual(["hidden.png"]);
        if (h.context.indexState.status !== "fresh")
            throw new Error("Expected fresh fixture");
        h.context.indexState = {
            status: "stale",
            summary: h.context.indexState.summary,
        };
        h.card(3).fire("click", { shiftKey: true, detail: 2 });
        expect(h.selectedKeys()).toEqual(["hidden.png"]);
        expect(h.failure).toHaveBeenCalledWith("index-stale");
    });

    it("isolates label events and preserves Shift checkbox ranges across progressive batches", () => {
        const h = remoteCards({}, 65);
        h.card(0).find("label").fire("click");
        const append = CardIntersectionObserver.instances[1];
        if (!append) throw new Error("Missing append observer");
        append.intersect(h.root.find(".remote-image-grid-sentinel"));
        h.card(64).find("input").fire("click", { shiftKey: true });
        expect(h.selectedKeys()).toHaveLength(66);
        h.card(64).find("input").fire("click", { shiftKey: true });
        expect(h.selectedKeys()).toEqual(["hidden.png"]);
        h.card(0).find("label").doubleClick();
        expect(h.selectedKeys()).toEqual(["hidden.png"]);
        expect(h.preview).not.toHaveBeenCalled();
    });

    it.each([
        [0, 64],
        [64, 0],
    ] as const)(
        "Shift-clicks cards %s to %s across progressive batches, skipping referenced objects",
        (start, end) => {
            const h = remoteCards({}, 65, true, [32]);
            const append = CardIntersectionObserver.instances[1];
            if (!append) throw new Error("Missing append observer");
            append.intersect(h.root.find(".remote-image-grid-sentinel"));
            h.card(start).fire("click");
            const anchor = h.browser.remoteSelectionAnchorKey;
            h.card(end).fire("click", { shiftKey: true });
            expect(h.selectedKeys()).toHaveLength(65);
            expect(h.selectedKeys()).not.toContain("32.png");
            expect(h.selectedKeys()).toContain("hidden.png");
            expect(h.browser.remoteSelectionAnchorKey).toBe(anchor);
            h.card(end).fire("click", { shiftKey: true });
            expect(h.selectedKeys()).toEqual(["hidden.png"]);
            expect(h.browser.remoteSelectionAnchorKey).toBe(anchor);
            expect(h.preview).not.toHaveBeenCalled();
        },
    );

    it.each([false, true])(
        "Shift double-click restores a mixed remote range (target selected: %s)",
        (selectedTarget) => {
            const h = remoteCards({}, 4);
            if (selectedTarget) h.card(3).fire("click");
            h.card(0).fire("click");
            const before = new Set(h.selectedKeys());
            const anchor = h.browser.remoteSelectionAnchorKey;
            h.card(3).doubleClick({ shiftKey: true });
            expect(new Set(h.selectedKeys())).toEqual(before);
            expect(h.browser.remoteSelectionAnchorKey).toBe(anchor);
            expect(h.card(1).find("input").checked).toBe(false);
            expect(h.card(2).find("input").checked).toBe(false);
            expect(h.preview).toHaveBeenCalledTimes(1);
        },
    );

    it("keeps keyboard and explicit preview controls separate from selection", () => {
        const h = remoteCards();
        const media = h.card(0).find(".remote-image-card-media");
        media.fire("keydown", { key: "Enter", isComposing: true });
        expect(h.preview).not.toHaveBeenCalled();
        expect(media.fire("keydown", { key: "Enter" }).defaultPrevented).toBe(
            true,
        );
        media.fire("keydown", { key: " " });
        h.card(0).find("button").doubleClick();
        h.card(0).find("button").fire("click", { detail: 0 });
        expect(h.preview).toHaveBeenCalledTimes(4);
        expect(h.selectedKeys()).toEqual(["hidden.png"]);
    });

    it("isolates retry clicks, double clicks, and bubbled keyboard events", () => {
        const h = remoteCards();
        const media = h.card(0).find(".remote-image-card-media");
        const observer = CardIntersectionObserver.instances[0];
        if (!observer) throw new Error("Missing thumbnail observer");
        observer.intersect(media);
        const request = h.enqueue.mock.calls[0];
        if (!request) throw new Error("Expected a thumbnail request");
        request[2].onError();
        const retry = media.find("button");
        retry.fire("keydown", { key: "Enter" });
        retry.doubleClick();
        expect(h.preview).not.toHaveBeenCalled();
        expect(h.selectionChange).not.toHaveBeenCalled();
        expect(h.enqueue).toHaveBeenLastCalledWith(
            h.provider,
            expect.anything(),
            expect.objectContaining({ force: true }),
        );
    });

    it("does not act on detached cards after the grid has been destroyed", () => {
        const h = remoteCards();
        const card = h.card(0);
        h.grid.destroy();
        card.doubleClick();
        card.find("button").fire("click");
        expect(h.selectedKeys()).toEqual(["hidden.png"]);
        expect(h.preview).not.toHaveBeenCalled();
    });
});
