export interface ReferenceTemplateVars {
    url: string;
    alt: string;
}

/**
 * Render a custom upload reference template when it contains the required URL placeholder.
 * Empty, whitespace-only, or invalid templates return null so callers can use Markdown safely.
 */
export function renderCustomReference(template: string, vars: ReferenceTemplateVars): string | null {
    if (!template.trim().includes('{url}')) return null;

    return template
        .replace(/\{url\}/g, () => vars.url)
        .replace(/\{alt\}/g, () => vars.alt);
}
