/** Minimal Obsidian DOM/event adapter for production card wiring tests in Node.
 * Models bubbling and label activation, not layout or native double-click timing.
 * Native keyboard/touch/browser behavior still requires Obsidian acceptance.
 */
type ElementOptions = {
    cls?: string;
    text?: string;
    attr?: Record<string, string>;
};
type EventOptions = {
    detail?: number;
    button?: number;
    ctrlKey?: boolean;
    metaKey?: boolean;
    shiftKey?: boolean;
    key?: string;
    isComposing?: boolean;
};

class CardEvent extends Event {
    detail = 1;
    button = 0;
    ctrlKey = false;
    metaKey = false;
    shiftKey = false;
    key = "";
    isComposing = false;
    stopped = false;

    constructor(type: string, options: EventOptions) {
        super(type, { bubbles: true, cancelable: true });
        Object.assign(this, options);
    }

    override stopPropagation(): void {
        this.stopped = true;
        super.stopPropagation();
    }
}

export class CardElement extends EventTarget {
    children: CardElement[] = [];
    parent: CardElement | null = null;
    classes = new Set<string>();
    attributes = new Map<string, string>();
    style: Record<string, string> = {};
    dataset: Record<string, string> = {};
    checked = false;
    textContent = "";
    isConnected = true;

    constructor(
        readonly tag = "div",
        options: ElementOptions = {},
    ) {
        super();
        for (const cls of (options.cls ?? "").split(" ").filter(Boolean))
            this.classes.add(cls);
        for (const [key, value] of Object.entries(options.attr ?? {}))
            this.setAttribute(key, value);
        this.textContent = options.text ?? "";
    }

    asElement(): HTMLElement {
        return this as unknown as HTMLElement;
    }
    createEl(tag: string, options?: ElementOptions): CardElement {
        return this.appendChild(new CardElement(tag, options));
    }
    createDiv(options?: ElementOptions): CardElement {
        return this.createEl("div", options);
    }
    createSpan(options?: ElementOptions): CardElement {
        return this.createEl("span", options);
    }
    appendChild(child: CardElement): CardElement {
        child.remove();
        child.parent = this;
        this.children.push(child);
        return child;
    }
    remove(): void {
        if (this.parent)
            this.parent.children = this.parent.children.filter(
                (child) => child !== this,
            );
        this.parent = null;
    }
    empty(): void {
        for (const child of this.children) child.parent = null;
        this.children = [];
    }
    setAttribute(name: string, value: string): void {
        this.attributes.set(name, value);
    }
    removeAttribute(name: string): void {
        this.attributes.delete(name);
    }
    addClass(name: string): void {
        this.classes.add(name);
    }
    toggleClass(name: string, active: boolean): void {
        if (active) this.classes.add(name);
        else this.classes.delete(name);
    }
    querySelector(selector: string): CardElement | null {
        return this.querySelectorAll(selector)[0] ?? null;
    }
    querySelectorAll(selector: string): CardElement[] {
        const result: CardElement[] = [];
        for (const child of this.children) {
            if (
                selector.startsWith(".")
                    ? child.classes.has(selector.slice(1))
                    : child.tag === selector
            )
                result.push(child);
            result.push(...child.querySelectorAll(selector));
        }
        return result;
    }
    find(selector: string): CardElement {
        const element = this.querySelector(selector);
        if (!element) throw new Error(`Missing test element: ${selector}`);
        return element;
    }
    private ancestors(): CardElement[] {
        return [this, ...(this.parent?.ancestors() ?? [])];
    }
    fire(type: string, options: EventOptions = {}): CardEvent {
        if (type === "click" && this.attributes.get("type") === "checkbox")
            this.checked = !this.checked;
        const event = new CardEvent(type, options);
        Object.defineProperty(event, "target", { value: this });
        for (const current of this.ancestors()) {
            current.dispatchEvent(event);
            if (event.stopped) break;
        }
        // Clicking label text activates its input even if bubbling was stopped.
        if (
            type === "click" &&
            this.tag !== "input" &&
            !event.defaultPrevented
        ) {
            const label = this.ancestors().find(
                (element) => element.tag === "label",
            );
            label?.querySelector("input")?.fire("click", options);
        }
        return event;
    }
    doubleClick(options: EventOptions = {}): void {
        this.fire("click", { ...options, detail: 1 });
        this.fire("click", { ...options, detail: 2 });
        this.fire("dblclick", { ...options, detail: 2 });
    }
}

export class CardIntersectionObserver {
    static instances: CardIntersectionObserver[] = [];
    targets = new Set<Element>();
    constructor(private callback: IntersectionObserverCallback) {
        CardIntersectionObserver.instances.push(this);
    }
    observe(target: Element): void {
        this.targets.add(target);
    }
    unobserve(target: Element): void {
        this.targets.delete(target);
    }
    disconnect(): void {
        this.targets.clear();
    }
    intersect(target: CardElement): void {
        this.callback(
            [
                {
                    target: target.asElement(),
                    isIntersecting: true,
                } as unknown as IntersectionObserverEntry,
            ],
            this as unknown as IntersectionObserver,
        );
    }
}
