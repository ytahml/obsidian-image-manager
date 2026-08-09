import { describe, expect, it } from 'vitest';
import { en } from '../src/i18n/en';
import { zh } from '../src/i18n/zh';

function variables(text: string): string[] {
    const result: string[] = [];
    const pattern = /\{([A-Za-z][A-Za-z0-9]*)\}/g;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text)) !== null) result.push(match[1]!);
    return result.sort();
}

describe('i18n catalogs', () => {
    it('keeps English and Chinese keys aligned', () => {
        expect(Object.keys(zh).sort()).toEqual(Object.keys(en).sort());
    });

    it('keeps interpolation variables aligned for every translation', () => {
        for (const key of Object.keys(en)) {
            expect(variables(zh[key]!), key).toEqual(variables(en[key]!));
        }
    });

    it('uses localized punctuation in labels that include punctuation', () => {
        expect(en['modal.imageBrowser.remoteProvider']).toBe('Hosting:');
        expect(zh['modal.imageBrowser.remoteProvider']).toBe('图床：');
    });
});
