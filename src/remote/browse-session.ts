import type { ImageHostingConfig } from '../types';
import { getRemoteManagementConfig } from './management-settings';
import { listRemoteObjects, type RemoteObjectProvider } from './provider';
import type { RemoteListPage, RemoteObject } from './types';

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
    error?: string;
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
    private error?: string;

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
        return this.loadPage(provider, config, undefined, 0, false);
    }

    async next(provider: RemoteObjectProvider, config: ImageHostingConfig): Promise<boolean> {
        const current = this.pages[this.currentPageIndex];
        if (!current?.result.isTruncated || !current.result.nextCursor) return false;
        const nextIndex = this.currentPageIndex + 1;
        const cached = this.pages[nextIndex];
        if (cached?.cursor === current.result.nextCursor) {
            this.currentPageIndex = nextIndex;
            this.status = cached.result.objects.length === 0 ? 'empty' : 'ready';
            return true;
        }
        return this.loadPage(provider, config, current.result.nextCursor, nextIndex, false);
    }

    previous(): boolean {
        if (this.currentPageIndex === 0) return false;
        this.currentPageIndex--;
        this.status = this.pages[this.currentPageIndex]!.result.objects.length === 0 ? 'empty' : 'ready';
        return true;
    }

    async refresh(provider: RemoteObjectProvider, config: ImageHostingConfig): Promise<boolean> {
        const page = this.pages[this.currentPageIndex];
        if (!page) return this.scan(provider, config);
        this.status = 'scanning';
        this.error = undefined;
        return this.loadPage(provider, config, page.cursor, this.currentPageIndex, true);
    }

    getCurrentObjects(): readonly RemoteObject[] {
        return this.pages[this.currentPageIndex]?.result.objects ?? [];
    }

    private async loadPage(
        provider: RemoteObjectProvider,
        config: ImageHostingConfig,
        cursor: string | undefined,
        pageIndex: number,
        replace: boolean
    ): Promise<boolean> {
        const requestGeneration = ++this.generation;
        this.status = 'scanning';
        this.error = undefined;
        const settings = getRemoteManagementConfig(config);
        try {
            const result = await listRemoteObjects(provider, {
                prefix: settings.prefix,
                cursor,
                limit: settings.pageSize,
            });
            if (requestGeneration !== this.generation) return false;
            if (result.isTruncated && !result.nextCursor) {
                this.status = 'error';
                this.error = 'invalid-cursor';
                return false;
            }
            if (result.nextCursor === cursor) {
                this.status = 'error';
                this.error = 'invalid-cursor';
                return false;
            }
            const page = { cursor, result };
            if (replace) {
                this.pages.splice(pageIndex, this.pages.length - pageIndex, page);
            } else {
                this.pages.splice(pageIndex, this.pages.length - pageIndex, page);
            }
            this.currentPageIndex = pageIndex;
            this.status = result.objects.length === 0 ? 'empty' : 'ready';
            return true;
        } catch (error) {
            if (requestGeneration !== this.generation) return false;
            this.status = 'error';
            this.error = error instanceof Error ? error.message : 'request-failed';
            return false;
        }
    }
}
