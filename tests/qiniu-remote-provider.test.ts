import { describe, expect, it, vi } from 'vitest';

vi.mock('obsidian', () => ({ requestUrl: vi.fn() }));

import type { RequestUrlParam, RequestUrlResponse } from 'obsidian';
import type { ImageHostingConfig, QiniuConfig } from '../src/types';
import { RemoteRequestClient } from '../src/remote/request';
import {
    parseQiniuListFolders,
    parseQiniuListObjects,
    QiniuRemoteObjectProvider,
} from '../src/remote/providers/qiniu-remote';
import { buildQiniuManagementSigningString } from '../src/qiniu/auth';

function hostingConfig(): ImageHostingConfig {
    const config: QiniuConfig = {
        accessKey: 'access-key', secretKey: 'secret-key', bucket: 'images', region: 'z0',
    };
    return {
        id: 'qiniu-hosting', name: 'Qiniu', type: 'qiniu', enabled: true, config,
        uploadPath: '', urlPrefix: 'https://cdn.example.com/vault',
        remoteManagement: {
            enabled: true, prefix: 'vault-a', pageSize: 100,
            previewMode: 'viewport', previewAccess: 'presigned',
            publicUrlAliases: ['https://origin.example.com/vault'],
        },
    };
}

function response(status: number, text: string): RequestUrlResponse {
    return { status, text, headers: {}, arrayBuffer: new ArrayBuffer(0), json: {} };
}

describe('Qiniu remote list parsing', () => {
    it('normalizes metadata, storage state, folders, and an opaque marker', () => {
        const page = parseQiniuListObjects({
            marker: 'next+/=&opaque',
            items: [{
                key: 'vault-a/中文 image.png', hash: 'etag', fsize: 42, mimeType: 'image/png',
                putTime: Date.parse('2024-07-03T09:46:40Z') * 10_000, type: 2, status: 1,
            }],
        }, 'qiniu-hosting');
        expect(page).toMatchObject({
            nextCursor: 'next+/=&opaque', isTruncated: true,
            objects: [{
                hostingId: 'qiniu-hosting', key: 'vault-a/中文 image.png', size: 42,
                etag: 'etag', mimeType: 'image/png', storageClass: 'ARCHIVE', availability: 'disabled',
            }],
        });
        expect(parseQiniuListFolders({ marker: '', commonPrefixes: ['vault-a/2026/', 'vault-a/中文/'] }))
            .toEqual({ prefixes: ['vault-a/2026', 'vault-a/中文'], isTruncated: false });
    });

    it('rejects malformed object metadata and non-string markers', () => {
        expect(() => parseQiniuListObjects({ items: [{ key: 'a.png', fsize: -1 }] }, 'qiniu-hosting'))
            .toThrow('Remote provider response could not be parsed');
        expect(() => parseQiniuListObjects({ marker: 123, items: [] }, 'qiniu-hosting'))
            .toThrow('Remote provider response could not be parsed');
    });
});

describe('Qiniu remote provider', () => {
    it('uses the required double line break after signed management headers', () => {
        const url = new URL('https://rsf.qiniuapi.com/list?bucket=images&limit=1');
        expect(buildQiniuManagementSigningString(
            'GET', url, 'application/x-www-form-urlencoded', '20260725T040506Z'
        )).toBe(
            'GET /list?bucket=images&limit=1\nHost: rsf.qiniuapi.com\n' +
            'Content-Type: application/x-www-form-urlencoded\nX-Qiniu-Date: 20260725T040506Z\n\n'
        );
    });

    it('uses the current list API with Qiniu management authorization and no secret leakage', async () => {
        const execute = vi.fn(async (_request: RequestUrlParam) => response(200, '{"marker":"","items":[]}'));
        const provider = new QiniuRemoteObjectProvider(
            hostingConfig(), new RemoteRequestClient(execute), () => new Date('2026-07-25T04:05:06Z')
        );
        await expect(provider.listObjects({ prefix: '/vault-a/', cursor: 'opaque+/=', limit: 5000 }))
            .resolves.toEqual({ objects: [], isTruncated: false });
        const request = execute.mock.calls[0]?.[0];
        expect(request?.url).toBe(
            'https://rsf.qiniuapi.com/list?bucket=images&limit=1000&prefix=vault-a%2F&marker=opaque%2B%2F%3D'
        );
        expect(request?.headers).toMatchObject({
            'Content-Type': 'application/x-www-form-urlencoded',
            'X-Qiniu-Date': '20260725T040506Z',
        });
        expect(request?.headers?.Authorization).toMatch(/^Qiniu access-key:/);
        expect(request?.headers?.Authorization).not.toContain('secret-key');
    });

    it('builds public and short-lived private preview URLs from the configured download domain', async () => {
        const config = hostingConfig();
        const provider = new QiniuRemoteObjectProvider(config, undefined, () => new Date('2026-07-25T04:05:06Z'));
        const object = { hostingId: config.id, key: 'vault-a/中文 #?.png', size: 1 };
        await expect(provider.createPreviewUrl(object)).resolves.toMatchObject({
            access: 'presigned', expiresAt: Date.parse('2026-07-25T04:10:06Z'),
        });
        const privatePreview = await provider.createPreviewUrl(object);
        expect(privatePreview.url).toContain('https://cdn.example.com/vault/vault-a/%E4%B8%AD%E6%96%87%20%23%3F.png?e=');
        expect(privatePreview.url).toContain('&token=access-key:');
        config.remoteManagement!.previewAccess = 'public';
        await expect(provider.createPreviewUrl(object)).resolves.toEqual({
            access: 'public', url: 'https://cdn.example.com/vault/vault-a/%E4%B8%AD%E6%96%87%20%23%3F.png',
        });
    });

    it('deletes the exact entry URI and preserves Qiniu failure semantics', async () => {
        const execute = vi.fn()
            .mockResolvedValueOnce(response(200, ''))
            .mockResolvedValueOnce(response(612, '{"error":"no such file"}'));
        const provider = new QiniuRemoteObjectProvider(
            hostingConfig(), new RemoteRequestClient(execute), () => new Date('2026-07-25T04:05:06Z')
        );
        const object = { hostingId: 'qiniu-hosting', key: 'vault-a/中文 #?.png', size: 1 };
        await expect(provider.deleteObject(object)).resolves.toMatchObject({ success: true, status: 200, deletionKind: 'permanent' });
        await expect(provider.deleteObject(object)).resolves.toMatchObject({ success: false, status: 612, failureCode: 'not-found' });
        expect(execute.mock.calls[0]?.[0]).toMatchObject({
            method: 'POST',
            url: 'https://rs.qiniuapi.com/delete/aW1hZ2VzOnZhdWx0LWEv5Lit5paHICM_LnBuZw==',
        });
    });
});
