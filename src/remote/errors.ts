export type RemoteProviderErrorCode =
    | 'authentication'
    | 'permission'
    | 'rate-limit'
    | 'network'
    | 'parsing'
    | 'unsupported'
    | 'service'
    | 'unknown';

interface RemoteProviderErrorOptions {
    status?: number;
    endpoint?: string;
    retryable?: boolean;
}

interface RemoteProviderErrorContext {
    url?: string;
    fallbackCode?: RemoteProviderErrorCode;
}

const ERROR_MESSAGES: Readonly<Record<RemoteProviderErrorCode, string>> = {
    authentication: 'Remote provider authentication failed.',
    permission: 'Remote provider permission was denied.',
    'rate-limit': 'Remote provider rate limit was reached.',
    network: 'Remote provider network request failed.',
    parsing: 'Remote provider response could not be parsed.',
    unsupported: 'Remote provider capability is not supported.',
    service: 'Remote provider service is unavailable.',
    unknown: 'Remote provider request failed.',
};

/** A user-safe provider error that never retains credentials or signed query parameters. */
export class RemoteProviderError extends Error {
    readonly code: RemoteProviderErrorCode;
    readonly status?: number;
    readonly endpoint?: string;
    readonly retryable: boolean;

    constructor(code: RemoteProviderErrorCode, options: RemoteProviderErrorOptions = {}) {
        super(ERROR_MESSAGES[code]);
        this.name = 'RemoteProviderError';
        this.code = code;
        this.status = options.status;
        this.endpoint = options.endpoint;
        this.retryable = options.retryable ?? isRetryable(code);
    }
}

/** Remove credentials, query parameters, and fragments from a request URL. */
export function sanitizeRemoteEndpoint(url: string | undefined): string | undefined {
    if (!url) return undefined;

    try {
        const parsed = new URL(url);
        return `${parsed.origin}${parsed.pathname}`;
    } catch {
        return undefined;
    }
}

/** Convert request failures into stable, redacted provider errors. */
export function toRemoteProviderError(
    error: unknown,
    context: RemoteProviderErrorContext = {}
): RemoteProviderError {
    if (error instanceof RemoteProviderError) return error;

    const status = readStatus(error);
    const code = status === undefined
        ? context.fallbackCode ?? 'unknown'
        : codeForHttpStatus(status);

    return new RemoteProviderError(code, {
        status,
        endpoint: sanitizeRemoteEndpoint(context.url),
    });
}

export function codeForHttpStatus(status: number): RemoteProviderErrorCode {
    if (status === 401) return 'authentication';
    if (status === 403) return 'permission';
    if (status === 429) return 'rate-limit';
    if (status >= 500) return 'service';
    return 'unknown';
}

function isRetryable(code: RemoteProviderErrorCode): boolean {
    return code === 'rate-limit' || code === 'network' || code === 'service';
}

function readStatus(error: unknown): number | undefined {
    if (typeof error !== 'object' || error === null || !('status' in error)) {
        return undefined;
    }

    const status = error.status;
    return typeof status === 'number' && Number.isFinite(status) ? status : undefined;
}
