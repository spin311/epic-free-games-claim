import { browser } from "wxt/browser";
// Type only: the browser serves the text, so the catalog stays out of the bundles.
import type englishMessages from "@/public/_locales/en/messages.json";

// Every key in the English catalog: a key that isn't there is a compile error.
export type MessageKey = keyof typeof englishMessages;

type PluralBase<K> = K extends `${infer Base}_one` ? (`${Base}_other` extends MessageKey ? Base : never) : never;
// A count message, which has a `<key>_one` and a `<key>_other` form.
export type PluralKey = PluralBase<MessageKey>;

export function t(key: MessageKey, substitutions?: string | string[]): string {
    return browser.i18n.getMessage(key, substitutions);
}

// For formatting dates, times and numbers in the browser's own language.
export function uiLocale(): string {
    return browser.i18n.getUILanguage();
}

// Plural rules of the catalog the browser actually serves, not of the UI
// language: with no translation for it, the text is English, and e.g.
// Japanese rules would turn "1 game" into "1 games".
function catalogLocale(): string {
    return t("catalogLocale").replace("_", "-");
}

/**
 * `<key>_one` or `<key>_other`, as the catalog's language counts `count`.
 * Categories beyond those two (few, many, ...) use `_other`. The count is the
 * substitution unless others are passed.
 */
export function tPlural(key: PluralKey, count: number, substitutions: string[] = [String(count)]): string {
    const form = new Intl.PluralRules(catalogLocale()).select(count) === "one" ? "one" : "other";
    return t(`${key}_${form}`, substitutions);
}

// An element inside a sentence (a button, a bold number): pass SLOT as that
// placeholder's substitution, then split the text around it, so the element
// sits wherever the translation puts it. A private-use character, never text.
export const SLOT = "";

export function splitAtSlot(text: string): [before: string, after: string] {
    const at = text.indexOf(SLOT);
    return at === -1 ? [text, ""] : [text.slice(0, at), text.slice(at + SLOT.length)];
}
