import { beforeEach, describe, expect, it, vi } from "vitest";

const { empty, removeEventListener, setAttribute } = vi.hoisted(() => ({
    empty: vi.fn(),
    removeEventListener: vi.fn(),
    setAttribute: vi.fn(),
}));

vi.mock("obsidian", () => ({
    Modal: class Modal {
        contentEl = { empty, setAttribute };

        close(): void {
            const target = this as unknown as { onClose?: () => void };
            target.onClose?.();
        }
    },
}));
vi.mock("../src/i18n", () => ({ t: (key: string) => key }));

import type { App } from "obsidian";
import { ConfirmDialog } from "../src/modals/confirm-dialog";

vi.stubGlobal("activeDocument", { removeEventListener });

describe("ConfirmDialog close semantics", () => {
    beforeEach(() => {
        empty.mockClear();
        removeEventListener.mockClear();
        setAttribute.mockClear();
    });

    it("reports cancellation exactly once when closed without confirmation", () => {
        const onCancel = vi.fn();
        const dialog = new ConfirmDialog({} as App, {
            title: "Confirm",
            message: "Continue?",
            onConfirm: vi.fn(),
            onCancel,
        });

        dialog.onClose();
        dialog.onClose();

        expect(onCancel).toHaveBeenCalledTimes(1);
        expect(empty).toHaveBeenCalledTimes(2);
        expect(removeEventListener).toHaveBeenCalledTimes(2);
    });

    it("does not report cancellation after confirmation starts", async () => {
        const onCancel = vi.fn();
        const onConfirm = vi.fn();
        const dialog = new ConfirmDialog({} as App, {
            title: "Confirm",
            message: "Continue?",
            onConfirm,
            onCancel,
        });

        await (
            dialog as unknown as { handleConfirm: () => Promise<void> }
        ).handleConfirm();

        expect(onConfirm).toHaveBeenCalledTimes(1);
        expect(onCancel).not.toHaveBeenCalled();
        expect(empty).toHaveBeenCalledTimes(1);
    });
});
