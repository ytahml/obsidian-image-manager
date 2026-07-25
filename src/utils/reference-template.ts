export interface ReferenceTemplateVars {
    fileUrl: string;
    fileAlt: string;
    fileName: string;
    fileBaseName: string;
    fileExt: string;
    fileWidth?: number;
    fileHeight?: number;
}

export type ReferenceTemplateFileVars = Omit<ReferenceTemplateVars, 'fileUrl' | 'fileAlt'>;

export type ReferenceTemplateValidation =
    | { status: 'disabled' }
    | { status: 'valid'; variables: string[]; requiresDimensions: boolean }
    | { status: 'invalid'; reason: 'missing-file-url' | 'unknown-variable'; unknownVariables: string[] };

const SUPPORTED_VARIABLES = new Set([
    'fileUrl',
    'fileAlt',
    'fileName',
    'fileBaseName',
    'fileExt',
    'fileWidth',
    'fileHeight',
]);
const PLACEHOLDER_REGEX = /\{([A-Za-z][A-Za-z0-9]*)\}/g;

export function validateReferenceTemplate(template: string): ReferenceTemplateValidation {
    if (!template.trim()) return { status: 'disabled' };

    const variables = extractTemplateVariables(template);
    if (!variables.includes('fileUrl')) {
        return { status: 'invalid', reason: 'missing-file-url', unknownVariables: [] };
    }

    const unknownVariables = Array.from(
        new Set(variables.filter((variable) => !SUPPORTED_VARIABLES.has(variable)))
    );
    if (unknownVariables.length > 0) {
        return { status: 'invalid', reason: 'unknown-variable', unknownVariables };
    }

    return {
        status: 'valid',
        variables,
        requiresDimensions: variables.includes('fileWidth') || variables.includes('fileHeight'),
    };
}

function extractTemplateVariables(template: string): string[] {
    const variables: string[] = [];
    const matcher = new RegExp(PLACEHOLDER_REGEX.source, PLACEHOLDER_REGEX.flags);
    let match: RegExpExecArray | null;
    while ((match = matcher.exec(template)) !== null) {
        const variable = match[1];
        if (variable !== undefined) variables.push(variable);
    }
    return variables;
}

export function referenceTemplateRequiresDimensions(template: string): boolean {
    const validation = validateReferenceTemplate(template);
    return validation.status === 'valid' && validation.requiresDimensions;
}

export async function resolveReferenceTemplateFileVars(
    template: string,
    file: { name: string; extension: string },
    readDimensions: () => Promise<{ width: number; height: number }>,
    onDimensionError?: (error: unknown) => void
): Promise<ReferenceTemplateFileVars> {
    const result: ReferenceTemplateFileVars = {
        fileName: file.name,
        fileBaseName: file.name.replace(/\.[^.]+$/, ''),
        fileExt: file.extension.toLowerCase(),
    };
    if (!referenceTemplateRequiresDimensions(template)) return result;

    try {
        const dimensions = await readDimensions();
        if (isPositiveInteger(dimensions.width)) result.fileWidth = dimensions.width;
        if (isPositiveInteger(dimensions.height)) result.fileHeight = dimensions.height;
    } catch (error) {
        onDimensionError?.(error);
    }
    return result;
}

/**
 * Render a custom upload reference template when it contains the required file URL placeholder.
 * Empty, whitespace-only, or invalid templates return null so callers can use Markdown safely.
 */
export function renderCustomReference(template: string, vars: ReferenceTemplateVars): string | null {
    const validation = validateReferenceTemplate(template);
    if (validation.status !== 'valid') return null;
    if (
        (validation.variables.includes('fileWidth') && !isPositiveInteger(vars.fileWidth))
        || (validation.variables.includes('fileHeight') && !isPositiveInteger(vars.fileHeight))
    ) {
        return null;
    }

    const values: Record<string, string> = {
        fileUrl: vars.fileUrl,
        fileAlt: vars.fileAlt,
        fileName: vars.fileName,
        fileBaseName: vars.fileBaseName,
        fileExt: vars.fileExt,
        ...(vars.fileWidth !== undefined ? { fileWidth: String(vars.fileWidth) } : {}),
        ...(vars.fileHeight !== undefined ? { fileHeight: String(vars.fileHeight) } : {}),
    };

    return template.replace(PLACEHOLDER_REGEX, (placeholder, variable: string) => {
        return values[variable] ?? placeholder;
    });
}

function isPositiveInteger(value: number | undefined): value is number {
    return value !== undefined && Number.isInteger(value) && value > 0;
}
