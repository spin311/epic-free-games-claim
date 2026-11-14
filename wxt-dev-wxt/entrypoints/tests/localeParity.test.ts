// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { Catalog, CatalogMessage } from './fakeI18n';

// Checks every translation in public/_locales against the English catalog.
// With English alone it passes trivially; it is there for the day a
// translation arrives, to catch what would break the popup or the extension.

const LOCALES_DIR = fileURLToPath(new URL('../../public/_locales', import.meta.url));
const DEFAULT_LOCALE = 'en';
// addons.mozilla.org rejects longer names; the Chrome Web Store, longer descriptions.
const MAX_NAME_LENGTH = 45;
const MAX_DESCRIPTION_LENGTH = 132;
const KEY_PATTERN = /^[A-Za-z0-9_]+$/;
const NAMED_PLACEHOLDER = /\$([A-Za-z0-9_@]+)\$/g;

function readCatalog(locale: string): Catalog {
  return JSON.parse(readFileSync(join(LOCALES_DIR, locale, 'messages.json'), 'utf-8')) as Catalog;
}

const english = readCatalog(DEFAULT_LOCALE);
const locales = readdirSync(LOCALES_DIR, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name);

// Placeholder names are case-insensitive to the browsers.
function usedPlaceholders(entry: CatalogMessage): string[] {
  return [...new Set([...entry.message.matchAll(NAMED_PLACEHOLDER)].map((match) => match[1].toLowerCase()))].sort();
}

function definedPlaceholders(entry: CatalogMessage): Record<string, string> {
  return Object.fromEntries(
    Object.entries(entry.placeholders ?? {}).map(([name, value]) => [name.toLowerCase(), value.content]),
  );
}

// Named placeholders are expanded first, then `$$` is a dollar sign. A `$`
// left after that is a positional substitution the code never passes: "$2"
// would print as nothing.
function hasStrayDollar(message: string): boolean {
  return message.replace(NAMED_PLACEHOLDER, '').replace(/\$\$/g, '').includes('$');
}

function messagesWhere(catalog: Catalog, isBad: (key: string, entry: CatalogMessage) => boolean): string[] {
  return Object.entries(catalog).filter(([key, entry]) => isBad(key, entry)).map(([key]) => key);
}

describe('English catalog', () => {
  it('uses only letters, digits and underscores in keys', () => {
    expect(Object.keys(english).filter((key) => !KEY_PATTERN.test(key))).toEqual([]);
  });

  it('has no two keys that differ only in case, which the browsers would treat as one', () => {
    const lower = Object.keys(english).map((key) => key.toLowerCase());
    expect(lower.filter((key, index) => lower.indexOf(key) !== index)).toEqual([]);
  });

  it('tells translators where each message appears', () => {
    expect(messagesWhere(english, (_key, entry) => !entry.description?.trim())).toEqual([]);
  });

  it('has a _one and an _other form for every count message', () => {
    const keys = new Set(Object.keys(english));
    const unpaired = [...keys].filter((key) =>
      (key.endsWith('_one') && !keys.has(key.replace(/_one$/, '_other')))
      || (key.endsWith('_other') && !keys.has(key.replace(/_other$/, '_one'))));
    expect(unpaired).toEqual([]);
  });
});

describe.each(locales)('_locales/%s/messages.json', (locale) => {
  const catalog = readCatalog(locale);

  it('has exactly the English keys', () => {
    expect(Object.keys(catalog).sort()).toEqual(Object.keys(english).sort());
  });

  it('uses and defines the same placeholders as English in every message', () => {
    const differing = messagesWhere(catalog, (key, entry) => {
      const source = english[key];
      if (!source) return false;
      return JSON.stringify([usedPlaceholders(entry), definedPlaceholders(entry)])
        !== JSON.stringify([usedPlaceholders(source), definedPlaceholders(source)]);
    });
    expect(differing).toEqual([]);
  });

  // Chrome refuses to load an extension whose message names an undefined placeholder.
  it('defines every placeholder its messages use', () => {
    const undefinedUse = messagesWhere(catalog, (_key, entry) => {
      const defined = definedPlaceholders(entry);
      return usedPlaceholders(entry).some((name) => !(name in defined));
    });
    expect(undefinedUse).toEqual([]);
  });

  it('writes a dollar sign as $$', () => {
    expect(messagesWhere(catalog, (_key, entry) => hasStrayDollar(entry.message))).toEqual([]);
  });

  it('has no empty message', () => {
    expect(messagesWhere(catalog, (_key, entry) => !entry.message.trim())).toEqual([]);
  });

  it(`keeps extName within ${MAX_NAME_LENGTH} characters`, () => {
    expect(catalog.extName?.message.length).toBeLessThanOrEqual(MAX_NAME_LENGTH);
  });

  it(`keeps extDescription within ${MAX_DESCRIPTION_LENGTH} characters`, () => {
    expect(catalog.extDescription?.message.length).toBeLessThanOrEqual(MAX_DESCRIPTION_LENGTH);
  });

  // tPlural takes its plural rules from this, so counts follow the language
  // the text is in even when the browser falls back to another catalog.
  it('names its own folder in catalogLocale', () => {
    expect(catalog.catalogLocale?.message).toBe(locale);
    expect(() => new Intl.PluralRules(locale.replace('_', '-'))).not.toThrow();
  });
});
