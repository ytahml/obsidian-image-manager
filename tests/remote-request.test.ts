import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RequestUrlResponse } from 'obsidian';

const { requestUrl } = vi.hoisted(() => ({ requestUrl: vi.fn() }));

vi.mock('obsidian', () => ({ requestUrl }));

import {
    RemoteProviderError,
    codeForHttpStatus,
    sanitizeRemoteEndpoint,
    toRemoteProviderError,
} from '../src/remote/errors';
import { RemoteRequestClient } from '../src/remote/request';

function createResponse(): RequestUrlResponse {
    return {
        status: 200,
        headers: {},
        arrayBuffer: new ArrayBuffer(0),
        json: {},
        text: '',
    };
}

describe('remote request boundary', () => {
    beforeEach(() => {
        requestUrl.mockReset();
    });

    it('uses Obsidian requestUrl through a mockable client boundary', async () => {
        const response = createResponse();
        requestUrl.mockResolvedValue(response);
        const client = new RemoteRequestClient();
        const request = {
            url: 'https://storage.example.com/bucket?list-type=2',
            method: 'GET',
        };

        await expect(client.request(request)).resolves.toBe(response);
        expect(requestUrl).toHaveBeenCalledWith(request);
    });

    it('maps HTTP failures and removes credentials and signed query parameters', async () => {
        const sensitiveUrl = 'https://user:password@storage.example.com/bucket'
            + '?X-Amz-Credential=access-key&X-Amz-Signature=secret-signature';
        requestUrl.mockRejectedValue({
            status: 403,
            message: `Denied Authorization=secret ${sensitiveUrl}`,
        });
        const client = new RemoteRequestClient();

        const promise = client.request({
            url: sensitiveUrl,
            headers: {
                Authorization: 'AWS4-HMAC-SHA256 secret',
                'x-access-key': 'access-key',
            },
        });

        await expect(promise).rejects.toMatchObject({
            name: 'RemoteProviderError',
            code: 'permission',
            status: 403,
            endpoint: 'https://storage.example.com/bucket',
            retryable: false,
        });
        await promise.catch((error: unknown) => {
            expect(error).toBeInstanceOf(RemoteProviderError);
            const safeOutput = error instanceof Error
                ? `${error.message} ${JSON.stringify(error)}`
                : JSON.stringify(error);
            expect(safeOutput).not.toContain('Authorization');
            expect(safeOutput).not.toContain('access-key');
            expect(safeOutput).not.toContain('secret');
            expect(safeOutput).not.toContain('X-Amz');
        });
    });

    it('maps failures without an HTTP status to a retryable network error', async () => {
        const execute = vi.fn().mockRejectedValue(new TypeError('token=private'));
        const client = new RemoteRequestClient(execute);

        await expect(client.request({ url: 'https://storage.example.com' }))
            .rejects.toMatchObject({
                code: 'network',
                retryable: true,
            });
    });
});

describe('remote provider error mapping', () => {
    it.each([
        [401, 'authentication'],
        [403, 'permission'],
        [429, 'rate-limit'],
        [500, 'service'],
        [400, 'unknown'],
    ] as const)('maps HTTP %s to %s', (status, code) => {
        expect(codeForHttpStatus(status)).toBe(code);
    });

    it('preserves an existing parsing error without wrapping it', () => {
        const error = new RemoteProviderError('parsing');

        expect(toRemoteProviderError(error)).toBe(error);
        expect(error.message).toBe('Remote provider response could not be parsed.');
    });

    it('does not return malformed URLs that could contain secrets', () => {
        expect(sanitizeRemoteEndpoint('not a URL?token=secret')).toBeUndefined();
    });
});
