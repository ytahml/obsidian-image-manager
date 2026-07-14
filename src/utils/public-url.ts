function decodeUnicodeSequence(sequence: string): string {
    const encodedBytes = sequence.match(/%[0-9a-f]{2}/gi);
    if (!encodedBytes) return sequence;

    let result = '';
    let index = 0;

    while (index < encodedBytes.length) {
        const firstByte = Number.parseInt(encodedBytes[index]!.slice(1), 16);
        let byteLength = 0;

        if (firstByte >= 0xC2 && firstByte <= 0xDF) byteLength = 2;
        else if (firstByte >= 0xE0 && firstByte <= 0xEF) byteLength = 3;
        else if (firstByte >= 0xF0 && firstByte <= 0xF4) byteLength = 4;

        if (byteLength === 0 || index + byteLength > encodedBytes.length) {
            result += encodedBytes[index]!;
            index++;
            continue;
        }

        const candidate = encodedBytes.slice(index, index + byteLength);
        const bytes = candidate.map((value) => Number.parseInt(value.slice(1), 16));
        const continuationBytesValid = bytes.slice(1).every((value) => value >= 0x80 && value <= 0xBF);

        if (!continuationBytesValid) {
            result += encodedBytes[index]!;
            index++;
            continue;
        }

        try {
            result += new TextDecoder('utf-8', { fatal: true }).decode(new Uint8Array(bytes));
            index += byteLength;
        } catch {
            result += encodedBytes[index]!;
            index++;
        }
    }

    return result;
}

/** Make Unicode path characters readable without decoding Markdown- or URL-sensitive ASCII. */
export function makePublicUrlReadable(url: string): string {
    const suffixIndex = url.search(/[?#]/);
    const pathAndOrigin = suffixIndex === -1 ? url : url.slice(0, suffixIndex);
    const suffix = suffixIndex === -1 ? '' : url.slice(suffixIndex);

    return pathAndOrigin.replace(/(?:%[0-9a-f]{2})+/gi, decodeUnicodeSequence) + suffix;
}
