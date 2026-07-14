import { requestUrl } from 'obsidian';
import { UploaderBase } from './uploader-base';
import type { UploadResult, ImageHostingConfig, AliyunOSSConfig } from '../types';

export class AliyunOSSUploader extends UploaderBase {
    readonly name = 'Aliyun OSS';

    constructor(config: ImageHostingConfig) {
        super(config);
    }

    async upload(data: ArrayBuffer, filename: string, sourcePath?: string): Promise<UploadResult> {
        const ossConfig = this.config.config as AliyunOSSConfig;
        const targetPath = await this.resolveUploadPath(filename, data, sourcePath);
        console.debug(`[AliyunOSS] Uploading to: ${targetPath}`);
        const contentType = this.guessMimeType(filename);
        const region = this.parseRegion(ossConfig.region);
        const host = `${ossConfig.bucket}.oss-${region}.aliyuncs.com`;
        // OSS 瑕佹眰瀵归潪 ASCII 瀛楃杩涜 URL 缂栫爜鍚庤绠楃鍚?
        const encodedPath = this.encodePathForOSS(targetPath);
        const url = `https://${host}/${encodedPath}`;
        const date = new Date().toUTCString();
        const resourcePath = `/${ossConfig.bucket}/${encodedPath}`;
        const stringToSign = `PUT\n\n${contentType}\n${date}\n${resourcePath}`;
        const signature = await this.hmacSha1Base64(stringToSign, ossConfig.accessKeySecret);

        try {
            const resp = await requestUrl({
                url,
                method: 'PUT',
                headers: {
                    Authorization: `OSS ${ossConfig.accessKeyId}:${signature}`,
                    Date: date,
                    'Content-Type': contentType,
                },
                body: data,
                throw: false,
            });

            if (resp.status >= 400) {
                console.error(`[AliyunOSS] Upload failed: HTTP ${resp.status}`, resp.text);
                return { success: false, error: `HTTP ${resp.status}: ${resp.text}`, originalPath: filename };
            }
            const publicUrl = this.config.urlPrefix
                ? `${this.config.urlPrefix}/${encodedPath}`
                : url;
            return { success: true, url: publicUrl, originalPath: filename };
        } catch (e) {
            const msg = e instanceof Error ? e.message : 'Upload failed';
            return { success: false, error: msg, originalPath: filename };
        }
    }

    async testConnection(): Promise<boolean> {
        const ossConfig = this.config.config as AliyunOSSConfig;
        const region = this.parseRegion(ossConfig.region);
        const host = `${ossConfig.bucket}.oss-${region}.aliyuncs.com`;
        const date = new Date().toUTCString();
        const resourcePath = `/${ossConfig.bucket}/`;
        const stringToSign = `GET\n\n\n${date}\n${resourcePath}`;
        const signature = await this.hmacSha1Base64(stringToSign, ossConfig.accessKeySecret);

        try {
            const resp = await requestUrl({
                url: `https://${host}/`,
                method: 'GET',
                headers: {
                    Authorization: `OSS ${ossConfig.accessKeyId}:${signature}`,
                    Date: date,
                },
                throw: false,
            });
            return resp.status === 200;
        } catch {
            return false;
        }
    }

    private parseRegion(region: string): string {
        let r = region.trim();
        if (r.includes('.aliyuncs.com')) r = r.replace('.aliyuncs.com', '');
        if (r.startsWith('oss-')) r = r.substring(4);
        return r;
    }

    private async hmacSha1Base64(stringToSign: string, secret: string): Promise<string> {
        const encoder = new TextEncoder();
        const key = await crypto.subtle.importKey(
            'raw',
            encoder.encode(secret),
            { name: 'HMAC', hash: 'SHA-1' },
            false,
            ['sign'],
        );
        const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(stringToSign));
        return btoa(String.fromCharCode(...new Uint8Array(sig)));
    }

    /** URL 缂傚倹鐗滈悥婊呮崉椤栨氨绐炲☉鎿冨幘濞堟垵袙韫囧酣鍤嬫繛鍫㈩暜缁辨繃绂掗崨顖滄そ闁活喕绶氬?ASCII 闁告粌鐬兼竟鎺戔枔婵犲倻鎽熺紒妤嬭缁辨繃绌卞┑鍫熸畬 / */
    private encodePathForOSS(path: string): string {
        return path.split('/').map(seg => encodeURIComponent(seg)).join('/');
    }

    async resolveUploadPath(filename: string, data?: ArrayBuffer, sourcePath?: string): Promise<string> {
        const now = new Date();
        let hash = '';
        if (data) {
            const hashBuf = await crypto.subtle.digest('SHA-256', data);
            hash = Array.from(new Uint8Array(hashBuf)).map((b) => ('0' + b.toString(16)).slice(-2)).join('').substring(0, 16);
        }
        // Extract file directory from sourcePath
        const fileDir = sourcePath ? sourcePath.split('/').slice(0, -1).join('/') : '';
        const vars: Record<string, string> = {
            year: now.getFullYear().toString(),
            month: String(now.getMonth() + 1).padStart(2, '0'),
            day: String(now.getDate()).padStart(2, '0'),
            filename: filename.replace(/\.[^.]+$/, ''),
            ext: filename.split('.').pop() ?? '',
            timestamp: Math.floor(now.getTime() / 1000).toString(),
            hash: hash || Math.random().toString(36).substring(2, 10),
            filePath: fileDir,
        };

        let template = this.config.uploadPath || 'images/{year}/{month}/{filename}.{ext}';
        // Ensure filename is always included
        if (!template.includes('{filename}')) {
            template = template.replace(/\/?$/, '/{filename}.{ext}');
        }
        for (const [key, value] of Object.entries(vars)) {
            template = template.replace(new RegExp(`\\{${key}\\}`, 'g'), value);
        }
        return template.replace(/^\/+/, '').replace(/\/+/g, '/');
    }

    private guessMimeType(filename: string): string {
        const ext = filename.split('.').pop()?.toLowerCase() ?? '';
        const map: Record<string, string> = {
            png: 'image/png',
            jpg: 'image/jpeg',
            jpeg: 'image/jpeg',
            gif: 'image/gif',
            webp: 'image/webp',
            svg: 'image/svg+xml',
            bmp: 'image/bmp',
        };
        return map[ext] ?? 'application/octet-stream';
    }
}
