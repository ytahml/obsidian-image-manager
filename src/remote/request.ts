import { requestUrl } from 'obsidian';
import type { RequestUrlParam, RequestUrlResponse } from 'obsidian';
import { toRemoteProviderError } from './errors';

/** Injectable request boundary used by remote providers and their unit tests. */
export type RemoteRequestExecutor = (
    request: RequestUrlParam
) => Promise<RequestUrlResponse>;

export class RemoteRequestClient {
    private readonly execute: RemoteRequestExecutor;

    constructor(execute: RemoteRequestExecutor = requestUrl) {
        this.execute = execute;
    }

    async request(request: RequestUrlParam): Promise<RequestUrlResponse> {
        try {
            return await this.execute(request);
        } catch (error) {
            throw toRemoteProviderError(error, {
                url: request.url,
                fallbackCode: 'network',
            });
        }
    }
}
