import type { RemoteObjectProvider } from './provider';
import {
    getRemoteDeleteConfigFingerprint,
    getRemoteDeleteUnavailableReason,
    type RemoteDeleteEligibilityContext,
    type RemoteDeleteUnavailableReason,
} from './delete-policy';
import type { RemoteDeleteResult, RemoteObject, RemoteReferenceState } from './types';

export const REMOTE_DELETE_BATCH_LIMIT = 20;
export const REMOTE_DELETE_CONCURRENCY = 2;

export interface RemoteDeleteSelectionResult {
    selected: boolean;
    reason?: RemoteDeleteUnavailableReason | 'limit';
}

export interface RemoteDeleteBatchSnapshot {
    objects: readonly RemoteObject[];
    states: ReadonlyMap<string, RemoteReferenceState>;
    configFingerprint: string;
    scannedAt: number;
    totalSize: number;
}

export interface RemoteDeleteRunOptions {
    onResult?: (object: RemoteObject, result: RemoteDeleteResult) => void | Promise<void>;
}

/** Provider-independent selection, validation, and bounded delete scheduling. */
export class RemoteDeleteSession {
    private selected = new Map<string, RemoteObject>();
    private generation = 0;

    clear(): void {
        this.generation++;
        this.selected.clear();
    }

    stop(): void {
        this.generation++;
    }

    getSelectedObjects(): RemoteObject[] {
        return [...this.selected.values()];
    }

    isSelected(object: RemoteObject): boolean {
        return this.selected.has(objectId(object));
    }

    setSelected(
        object: RemoteObject,
        selected: boolean,
        context: RemoteDeleteEligibilityContext
    ): RemoteDeleteSelectionResult {
        const id = objectId(object);
        if (!selected) {
            this.selected.delete(id);
            return { selected: false };
        }
        const reason = getRemoteDeleteUnavailableReason(object, context);
        if (reason) return { selected: false, reason };
        if (!this.selected.has(id) && this.selected.size >= REMOTE_DELETE_BATCH_LIMIT) {
            return { selected: false, reason: 'limit' };
        }
        this.selected.set(id, object);
        return { selected: true };
    }

    replaceSelection(
        objects: readonly RemoteObject[],
        context: RemoteDeleteEligibilityContext
    ): RemoteDeleteSelectionResult {
        this.selected.clear();
        for (const object of objects) {
            const result = this.setSelected(object, true, context);
            if (!result.selected) {
                this.selected.clear();
                return result;
            }
        }
        return { selected: this.selected.size > 0 };
    }

    createBatch(context: RemoteDeleteEligibilityContext): RemoteDeleteBatchSnapshot | undefined {
        const objects = this.getSelectedObjects();
        if (objects.length === 0 || objects.length > REMOTE_DELETE_BATCH_LIMIT) return undefined;
        const states = new Map<string, RemoteReferenceState>();
        for (const object of objects) {
            if (getRemoteDeleteUnavailableReason(object, context)) return undefined;
            states.set(objectId(object), context.classify(object));
        }
        if (context.indexState.status !== 'fresh') return undefined;
        return {
            objects,
            states,
            configFingerprint: getRemoteDeleteConfigFingerprint(context.config),
            scannedAt: context.indexState.summary.scannedAt,
            totalSize: objects.reduce((total, object) => total + object.size, 0),
        };
    }

    validateBatch(
        batch: RemoteDeleteBatchSnapshot,
        context: RemoteDeleteEligibilityContext
    ): boolean {
        if (context.indexState.status !== 'fresh') return false;
        if (batch.configFingerprint !== getRemoteDeleteConfigFingerprint(context.config)) return false;
        if (batch.scannedAt !== context.indexState.summary.scannedAt) return false;
        return batch.objects.every((object) =>
            getRemoteDeleteUnavailableReason(object, context) === undefined
        );
    }

    async run(
        provider: RemoteObjectProvider,
        batch: RemoteDeleteBatchSnapshot,
        options: RemoteDeleteRunOptions = {}
    ): Promise<RemoteDeleteResult[]> {
        if (!provider.capabilities.has('delete') || !provider.deleteObject) return [];
        const deleteObject = provider.deleteObject.bind(provider);
        const runGeneration = ++this.generation;
        const queue = [...batch.objects];
        const results: RemoteDeleteResult[] = [];
        const worker = async () => {
            while (runGeneration === this.generation) {
                const object = queue.shift();
                if (!object) return;
                let result: RemoteDeleteResult;
                try {
                    result = await deleteObject(object);
                } catch {
                    result = {
                        key: object.key,
                        success: false,
                        failureCode: 'unknown',
                        retryable: false,
                    };
                }
                results.push(result);
                await options.onResult?.(object, result);
            }
        };
        await Promise.all(Array.from(
            { length: Math.min(REMOTE_DELETE_CONCURRENCY, queue.length) },
            () => worker()
        ));
        return results;
    }
}

function objectId(object: RemoteObject): string {
    return `${object.hostingId}\u0000${object.key}`;
}
