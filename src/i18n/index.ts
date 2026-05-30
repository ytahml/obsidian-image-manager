import { en } from './en';
import { zh } from './zh';

export type Locale = 'en' | 'zh';

const translations: Record<Locale, Record<string, string>> = { en, zh };

let currentLocale: Locale = 'en';

export function setLocale(locale: Locale): void {
    currentLocale = locale;
}

export function t(key: string, vars?: Record<string, string>): string {
    let text = translations[currentLocale]?.[key] ?? en[key] ?? key;
    if (vars) {
        for (const [k, v] of Object.entries(vars)) {
            text = text.replace(new RegExp(`\\{${k}\\}`, 'g'), v);
        }
    }
    return text;
}
