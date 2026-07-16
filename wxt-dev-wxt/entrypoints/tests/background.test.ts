// @vitest-environment node
// Lives under entrypoints/tests/ (not entrypoints/ root) so WXT doesn't treat it
// as a duplicate "background" entrypoint. Node env avoids the esbuild/jsdom clash
// from importing background.ts (which pulls in `#imports`).
import { describe, it, expect } from 'vitest';
import { areDatesDifferent, didEnoughTimePass, formatEpicFreeGame, withEpicEnglishLocale } from '../background';
import { Platforms } from '../enums/platforms';

describe('areDatesDifferent', () => {
  it('is true for different calendar days', () => {
    expect(areDatesDifferent('2026-01-01T12:00:00Z', '2026-06-15T12:00:00Z')).toBe(true);
  });

  it('is false for the same instant', () => {
    expect(areDatesDifferent('2026-01-01T12:00:00Z', '2026-01-01T12:00:00Z')).toBe(false);
  });

  it('is false when the first date is empty (never claimed)', () => {
    expect(areDatesDifferent('', '2026-06-15T12:00:00Z')).toBe(false);
  });
});

describe('didEnoughTimePass', () => {
  it('is true when more than the required minutes elapsed', () => {
    const twoHoursAgo = new Date(Date.now() - 120 * 60 * 1000).toISOString();
    expect(didEnoughTimePass(twoHoursAgo, 60)).toBe(true);
  });

  it('is false when not enough time has passed', () => {
    const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    expect(didEnoughTimePass(fiveMinAgo, 60)).toBe(false);
  });
});

describe('formatEpicFreeGame', () => {
  it('maps an Epic API element to a FreeGame', () => {
    const el = {
      title: 'Test Game',
      productSlug: 'test-game',
      description: 'desc',
      keyImages: [{ type: 'Thumbnail', url: 'https://img/thumb.jpg' }],
      promotions: {
        promotionalOffers: [
          { promotionalOffers: [{ startDate: '2026-01-01T00:00:00Z', endDate: '2026-01-08T00:00:00Z' }] },
        ],
      },
    } as any;

    const game = formatEpicFreeGame(el, false);
    expect(game.title).toBe('Test Game');
    expect(game.platform).toBe(Platforms.Epic);
    expect(game.link).toBe('https://www.epicgames.com/store/en-US/p/test-game');
    expect(game.img).toBe('https://img/thumb.jpg');
    expect(game.future).toBe(false);
    expect(game.endDate).toBe('2026-01-08T00:00:00.000Z');
  });

  it('uses the /bundle/ path for bundle products', () => {
    const el = { title: 'B', productSlug: 'b', categories: [{ path: 'bundles' }] } as any;
    expect(formatEpicFreeGame(el, false).link).toContain('/bundle/');
  });

  it('falls back to the default icon when no image is present', () => {
    const el = { title: 'X', productSlug: 'x' } as any;
    expect(formatEpicFreeGame(el, false).img).toBe('/icon/128.png');
  });
});

describe('withEpicEnglishLocale', () => {
  it('forces lang=en-US on an epicgames.com URL with no lang', () => {
    expect(withEpicEnglishLocale('https://www.epicgames.com/store/de/p/x'))
      .toBe('https://www.epicgames.com/store/de/p/x?lang=en-US');
  });

  it('overrides a non-English lang param', () => {
    expect(withEpicEnglishLocale('https://store.epicgames.com/p/x?lang=de'))
      .toBe('https://store.epicgames.com/p/x?lang=en-US');
  });

  it('leaves non-Epic URLs unchanged', () => {
    const steam = 'https://store.steampowered.com/app/1/';
    expect(withEpicEnglishLocale(steam)).toBe(steam);
  });
});
