export interface ReferenceTemplateVars {
    url: string;
}

/** Replace the {url} placeholder in a custom reference template.
 *  The caller treats an empty template as "use the default Markdown reference". */
export function renderCustomReference(template: string, vars: ReferenceTemplateVars): string {
    return template.replace(/\{url\}/g, vars.url);
}
