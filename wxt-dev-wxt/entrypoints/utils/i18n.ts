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

// The catalog the browser actually serves, as a BCP 47 tag (pt_BR -> pt-BR).
// Not the UI language: with no translation for it, the text is English.
function catalogLocale(): string {
    return t("catalogLocale").replace("_", "-");
}

const languageOf = (tag: string): string => tag.split(/[-_]/)[0].toLowerCase();

/**
 * For dates, times and numbers: the language of the sentence around them,
 * so a German browser shown the English catalog reads "Free until Nov 13",
 * not "13. Nov.". When the browser's language is the catalog's, its region
 * is kept (en-GB: "13 Nov").
 */
export function formatLocale(): string {
    const catalog = catalogLocale();
    const ui = browser.i18n.getUILanguage();
    return languageOf(ui) === languageOf(catalog) ? ui.replace("_", "-") : catalog;
}

/**
 * `<key>_one` or `<key>_other`, as the catalog's language counts `count`
 * (Japanese rules would turn the English "1 game" into "1 games").
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
