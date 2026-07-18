import { RemoteProviderError } from './errors';
import type { RemoteObjectProvider } from './provider';
import type { RemoteObject, RemotePreviewUrl } from './types';

const EXPIRY_SAFETY_WINDOW_MS = 30_000;

/** Keeps preview URLs and counters in memory for one remote browser view. */
export class RemotePreviewSession {
    private generation = 0;
    private requestCount = 0;
    private readonly cache = new Map<string, RemotePreviewUrl>();
    private readonly pending = new Map<string, Promise<RemotePreviewUrl | undefined>>();

    invalidate(): void {
        this.generation++;
        this.cache.clear();
        this.pending.clear();
    }

    getRequestCount(): number {
        return this.requestCount;
    }

    recordImageRequest(): number {
        return ++this.requestCount;
    }

    async resolveUrl(
        provider: RemoteObjectProvider,
        object: RemoteObject,
        options: { force?: boolean; now?: number } = {}
    ): Promise<RemotePreviewUrl | undefined> {
        if (!provider.capabilities.has('preview') || !provider.createPreviewUrl) {
            throw new RemoteProviderError('unsupported');
        }

        const now = options.now ?? Date.now();
        const key = `${object.hostingId}\u0000${object.key}`;
        const cached = this.cache.get(key);
        if (!options.force && cached && isReusable(cached, now)) return cached;
        const pending = this.pending.get(key);
        if (!options.force && pending) return pending;

        if (options.force) this.cache.delete(key);
        const generation = this.generation;
        const request = provider.createPreviewUrl(object).then((preview) => {
            if (generation !== this.generation || this.pending.get(key) !== request) return undefined;
            this.cache.set(key, preview);
            return preview;
        });
        this.pending.set(key, request);
        try {
            return await request;
        } finally {
            if (this.pending.get(key) === request) this.pending.delete(key);
        }
    }
}

function isReusable(preview: RemotePreviewUrl, now: number): boolean {
    return preview.expiresAt === undefined || preview.expiresAt - now > EXPIRY_SAFETY_WINDOW_MS;
}
