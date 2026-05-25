import { App } from 'obsidian';

export interface UploadRecord {
    remoteUrl: string;
    hostingId: string;
    timestamp: number;
}

export class UploadCache {
    private app: App;
    private cachePath: string;
    private records: Record<string, UploadRecord> = {};
    private loaded = false;

    constructor(app: App) {
        this.app = app;
        this.cachePath = '.obsidian/obsidian-image-manager-cache.json';
    }

    async load(): Promise<void> {
        try {
            if (await this.app.vault.adapter.exists(this.cachePath)) {
                const content = await this.app.vault.adapter.read(this.cachePath);
                this.records = JSON.parse(content);
            }
        } catch {
            this.records = {};
        }
        this.loaded = true;
    }

    private async ensureLoaded(): Promise<void> {
        if (!this.loaded) await this.load();
    }

    async set(localPath: string, record: UploadRecord): Promise<void> {
        await this.ensureLoaded();
        this.records[localPath] = record;
        await this.save();
    }

    async getByLocalPath(localPath: string): Promise<UploadRecord | undefined> {
        await this.ensureLoaded();
        return this.records[localPath];
    }

    async getByRemoteUrl(remoteUrl: string): Promise<{ localPath: string; record: UploadRecord } | undefined> {
        await this.ensureLoaded();
        for (const [localPath, record] of Object.entries(this.records)) {
            if (record.remoteUrl === remoteUrl) {
                return { localPath, record };
            }
        }
        return undefined;
    }

    async remove(localPath: string): Promise<void> {
        await this.ensureLoaded();
        delete this.records[localPath];
        await this.save();
    }

    async getAll(): Promise<Record<string, UploadRecord>> {
        await this.ensureLoaded();
        return { ...this.records };
    }

    private async save(): Promise<void> {
        const content = JSON.stringify(this.records, null, 2);
        await this.app.vault.adapter.write(this.cachePath, content);
    }
}
