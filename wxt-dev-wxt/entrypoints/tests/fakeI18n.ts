// WXT's fake browser leaves browser.i18n unimplemented (every call throws).
// This stands in for it with the browsers' own messages.json rules, so code
// under test gets the real English text and tests can assert on it.

export interface CatalogMessage {
    message: string;
    description?: string;
    placeholders?: Record<string, { content: string; example?: string }>;
}

export type Catalog = Record<string, CatalogMessage>;

const NAMED_PLACEHOLDER = /\$([A-Za-z0-9_@]+)\$/g;
const DOLLAR_OR_POSITIONAL = /\$(\$|[1-9])/g;

// As Chrome and Firefox do it: `$NAME$` becomes its placeholder's content
// (names are case-insensitive), then `$1`-`$9` take the substitutions and `$$`
// is a literal dollar sign. An unknown key gives "".
export function fakeGetMessage(catalog: Catalog) {
    const byLowerName = new Map(Object.entries(catalog).map(([name, entry]) => [name.toLowerCase(), entry]));
    return (name: string, substitutions?: string | string[]): string => {
        const entry = byLowerName.get(name.toLowerCase());
        if (!entry) return "";
        const values = substitutions === undefined ? [] : [substitutions].flat();
        const placeholders = new Map(
            Object.entries(entry.placeholders ?? {}).map(([key, value]) => [key.toLowerCase(), value.content]),
        );
        const expanded = entry.message.replace(NAMED_PLACEHOLDER, (match, placeholder: string) =>
            placeholders.get(placeholder.toLowerCase()) ?? match);
        return expanded.replace(DOLLAR_OR_POSITIONAL, (_match, token: string) =>
            token === "$" ? "$" : values[Number(token) - 1] ?? "");
    };
}
