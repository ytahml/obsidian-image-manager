import type { ImageHostingConfig } from '../types';
import { getRemoteManagementConfig } from './management-settings';
import { listRemoteObjects, type RemoteObjectProvider } from './provider';
import type { RemoteListPage, RemoteObject } from './types';
import { RemoteProviderError, type RemoteProviderErrorCode } from './errors';

export const REMOTE_LIST_BATCH_SIZE = 1000;

export type RemoteBrowseStatus =
    | 'idle'
    | 'confirming'
    | 'scanning'
    | 'ready'
    | 'empty'
    | 'stopped'
    | 'error'
    | 'unsupported';

export interface RemoteBrowsePage {
    cursor?: string;
    result: RemoteListPage;
}

export interface RemoteBrowseSnapshot {
    status: RemoteBrowseStatus;
    pages: readonly RemoteBrowsePage[];
    currentPageIndex: number;
    error?: RemoteBrowseFailure;
}

export interface RemoteBrowseFailure {
    code: RemoteProviderErrorCode | 'invalid-cursor' | 'request-failed';
    status?: number;
}

/**
 * Provider-independent pagination state. It deliberately owns opaque cursors
 * and uses a generation counter so stale async results cannot publish.
 */
export class RemoteBrowseSession {
    private generation = 0;
    private pages: RemoteBrowsePage[] = [];
    private currentPageIndex = 0;
    private status: RemoteBrowseStatus = 'idle';
    private error?: RemoteBrowseFailure;

    getSnapshot(): RemoteBrowseSnapshot {
        return {
            status: this.status,
            pages: this.pages,
            currentPageIndex: this.currentPageIndex,
            error: this.error,
        };
    }

    invalidate(status: RemoteBrowseStatus = 'idle') {
        this.generation++;
        this.pages = [];
        this.currentPageIndex = 0;
        this.status = status;
        this.error = undefined;
    }

    stop() {
        this.generation++;
        this.status = 'stopped';
        this.error = undefined;
    }

    async scan(provider: RemoteObjectProvider, config: ImageHostingConfig): Promise<boolean> {
        this.invalidate('scanning');
        return this.loadPage(provider, config, undefined, 0);
    }

    async next(provider: RemoteObjectProvider, config: ImageHostingConfig): Promise<boolean> {
        const current = this.pages[this.currentPageIndex];
        if (!current?.result.isTruncated || !current.result.nextCursor) return false;
        const nextIndex = this.currentPageIndex + 1;
        const cached = this.pages[nextIndex];
        if (cached?.cursor === current.result.nextCursor) {
            this.currentPageIndex = nextIndex;
            this.status = this.getAllObjects().length === 0 ? 'empty' : 'ready';
            return true;
        }
        return this.loadPage(provider, config, current.result.nextCursor, nextIndex);
    }

    async loadNextBatch(
        provider: RemoteObjectProvider,
        config: ImageHostingConfig,
        maxRequests: number
    ): Promise<boolean> {
        for (let request = 0; request < maxRequests && this.hasMore(); request++) {
            if (!await this.next(provider, config)) return false;
        }
        return true;
    }

    hasMore(): boolean {
        const current = this.pages[this.pages.length - 1];
        return Boolean(current?.result.isTruncated && current.result.nextCursor);
    }

    getAllObjects(): RemoteObject[] {
        return this.pages.flatMap((page) => page.result.objects);
    }

    private async loadPage(
        provider: RemoteObjectProvider,
        config: ImageHostingConfig,
        cursor: string | undefined,
        pageIndex: number
    ): Promise<boolean> {
        const requestGeneration = ++this.generation;
        this.status = 'scanning';
        this.error = undefined;
        const settings = getRemoteManagementConfig(config);
        try {
            const result = await listRemoteObjects(provider, {
                prefix: settings.prefix,
                cursor,
                limit: REMOTE_LIST_BATCH_SIZE,
            });
            if (requestGeneration !== this.generation) return false;
            if (result.isTruncated && !result.nextCursor) {
                this.status = 'error';
                this.error = { code: 'invalid-cursor' };
                return false;
            }
            if (result.isTruncated && result.nextCursor === cursor) {
                this.status = 'error';
                this.error = { code: 'invalid-cursor' };
                return false;
            }
            const page = { cursor, result };
            this.pages.splice(pageIndex, this.pages.length - pageIndex, page);
            this.currentPageIndex = pageIndex;
            this.status = this.getAllObjects().length === 0 ? 'empty' : 'ready';
            return true;
        } catch (error) {
            if (requestGeneration !== this.generation) return false;
            this.status = 'error';
            this.error = error instanceof RemoteProviderError
                ? { code: error.code, ...(error.status !== undefined ? { status: error.status } : {}) }
                : { code: 'request-failed' };
            return false;
        }
    }
}
