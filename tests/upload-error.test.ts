import { describe, expect, it } from 'vitest';
import { summarizeUploadError } from '../src/uploaders/upload-error';

describe('summarizeUploadError', () => {
    it('keeps the HTTP status and OSS error code without exposing the response body', () => {
        expect(summarizeUploadError(
            'HTTP 403: <Error><Code>SignatureDoesNotMatch</Code><Message>secret detail</Message></Error>'
        )).toBe('HTTP 403 (SignatureDoesNotMatch)');
    });

    it('returns a concise fallback for empty and non-HTTP failures', () => {
        expect(summarizeUploadError(undefined)).toBe('Unknown error');
        expect(summarizeUploadError(' Network\n request failed ')).toBe('Network request failed');
    });
});
