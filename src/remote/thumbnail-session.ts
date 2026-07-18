import type { RemoteObjectProvider } from './provider';
import { RemotePreviewSession } from './preview-session';
import type { RemoteObject, RemotePreviewUrl } from './types';

interface ThumbnailJob {
    generation: number;
    provider: RemoteObjectProvider;
    object: RemoteObject;
    force: boolean;
    onReady: (preview: RemotePreviewUrl) => void;
    onError: () => void;
}

/** Resolves visible thumbnail URLs with a bounded queue. */
export class RemoteThumbnailSession {
    private generation = 0;
    private active = 0;
    private queue: ThumbnailJob[] = [];

    constructor(
        private previewSession: RemotePreviewSession,
        private concurrency = 4
    ) {}

    resetView(): void {
        this.generation++;
        this.queue = [];
    }

    invalidate(): void {
        this.resetView();
        this.previewSession.invalidate();
    }

    enqueue(
        provider: RemoteObjectProvider,
        object: RemoteObject,
        callbacks: {
            force?: boolean;
            onReady: (preview: RemotePreviewUrl) => void;
            onError: () => void;
        }
    ): void {
        this.queue.push({
            generation: this.generation,
            provider,
            object,
            force: callbacks.force ?? false,
            onReady: callbacks.onReady,
            onError: callbacks.onError,
        });
        this.drain();
    }

    private drain(): void {
        while (this.active < this.concurrency) {
            const job = this.queue.shift();
            if (!job) return;
            if (job.generation !== this.generation) continue;
            this.active++;
            void this.run(job);
        }
    }

    private async run(job: ThumbnailJob): Promise<void> {
        try {
            const preview = await this.previewSession.resolveUrl(job.provider, job.object, {
                force: job.force,
            });
            if (preview && job.generation === this.generation) job.onReady(preview);
        } catch {
            if (job.generation === this.generation) job.onError();
        } finally {
            this.active--;
            this.drain();
        }
    }
}
