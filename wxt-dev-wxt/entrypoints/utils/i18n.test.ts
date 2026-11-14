import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing';
import { SLOT, splitAtSlot, t, tPlural, uiLocale } from './i18n';

// The English catalog comes from the shared test setup (entrypoints/tests/setup.ts).
const englishGetMessage = fakeBrowser.i18n.getMessage;

function useCatalogLocale(locale: string) {
  vi.spyOn(fakeBrowser.i18n, 'getMessage').mockImplementation(((name: string, substitutions?: string | string[]) =>
    name === 'catalogLocale' ? locale : englishGetMessage(name, substitutions)) as typeof englishGetMessage);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('t', () => {
  it('returns a plain message', () => {
    expect(t('extActionTitle')).toBe('Free Games Claimer');
  });

  it('fills in a substitution', () => {
    expect(t('headerClaimedCount_other', '7')).toBe('7 games claimed');
  });
});

describe('tPlural', () => {
  it('uses the one form for a single item', () => {
    expect(tPlural('headerClaimedCount', 1)).toBe('1 game claimed');
  });

  it('uses the other form otherwise, zero included', () => {
    expect(tPlural('headerClaimedCount', 0)).toBe('0 games claimed');
    expect(tPlural('headerClaimedCount', 47)).toBe('47 games claimed');
  });

  // A browser in a language with no translation shows the English catalog.
  // Japanese rules file 1 under "other", which would read "1 games claimed".
  it('follows the plural rules of the catalog in use, not the browser language', () => {
    vi.spyOn(fakeBrowser.i18n, 'getUILanguage').mockReturnValue('ja');

    expect(tPlural('headerClaimedCount', 1)).toBe('1 game claimed');
  });

  it("follows a translation's own rules", () => {
    // French files 0 under "one".
    useCatalogLocale('fr');

    expect(tPlural('headerClaimedCount', 0)).toBe('0 game claimed');
  });

  it('reads a region-specific catalog name such as pt_BR', () => {
    useCatalogLocale('pt_BR');

    expect(tPlural('headerClaimedCount', 1)).toBe('1 game claimed');
  });

  it('takes other substitutions in place of the count', () => {
    expect(tPlural('headerClaimedCount', 2, ['two'])).toBe('two games claimed');
  });
});

describe('uiLocale', () => {
  it("is the browser's UI language", () => {
    vi.spyOn(fakeBrowser.i18n, 'getUILanguage').mockReturnValue('de');

    expect(uiLocale()).toBe('de');
  });
});

describe('splitAtSlot', () => {
  it('splits a message around the element passed as SLOT', () => {
    expect(splitAtSlot(t('headerClaimedCount_other', SLOT))).toEqual(['', ' games claimed']);
  });

  it('puts the element last when a translation leaves its placeholder out', () => {
    expect(splitAtSlot('No placeholder here')).toEqual(['No placeholder here', '']);
  });
});
