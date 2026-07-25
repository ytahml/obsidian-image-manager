export interface ReferenceTemplateVars {
    fileUrl: string;
    fileAlt: string;
}

/**
 * Render a custom upload reference template when it contains the required file URL placeholder.
 * Empty, whitespace-only, or invalid templates return null so callers can use Markdown safely.
 */
export function renderCustomReference(template: string, vars: ReferenceTemplateVars): string | null {
    if (!template.trim().includes('{fileUrl}')) return null;

    return template
        .replace(/\{fileUrl\}/g, () => vars.fileUrl)
        .replace(/\{fileAlt\}/g, () => vars.fileAlt);
}
