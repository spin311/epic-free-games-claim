// @vitest-environment node
// Lives under entrypoints/tests/ (not entrypoints/ root) so WXT doesn't treat it
// as a duplicate "background" entrypoint. Node env avoids the esbuild/jsdom clash
// from importing background.ts (which pulls in `#imports`).
import { describe, it, expect } from 'vitest';
import {
  areDatesDifferent,
  background,
  didEnoughTimePass,
  EPIC_FREE_GAMES_URL,
  formatEpicFreeGame,
  partitionEpicPromotions,
  resolveEpicSlug,
  withEpicEnglishLocale,
} from '../background';
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
    expect(game.link).toBe('https://store.epicgames.com/en-US/p/test-game');
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

describe('resolveEpicSlug', () => {
  it('prefers the catalogNs pageSlug over a productSlug carrying a /home suffix', () => {
    const el = {
      productSlug: 'cardpocalypse/home',
      catalogNs: { mappings: [{ pageSlug: 'cardpocalypse' }] },
    } as any;
    expect(resolveEpicSlug(el)).toBe('cardpocalypse');
  });

  it('strips a trailing /home segment when only productSlug is present', () => {
    expect(resolveEpicSlug({ productSlug: 'cardpocalypse/home' } as any)).toBe('cardpocalypse');
  });

  it('strips surrounding slashes', () => {
    expect(resolveEpicSlug({ productSlug: '/some-game/' } as any)).toBe('some-game');
  });

  it('falls back to offerMappings when catalogNs has no usable slug', () => {
    const el = {
      catalogNs: { mappings: [{}] },
      offerMappings: [{ pageSlug: 'from-offer' }],
    } as any;
    expect(resolveEpicSlug(el)).toBe('from-offer');
  });

  it('returns an empty string when no slug is available', () => {
    expect(resolveEpicSlug({ title: 'X' } as any)).toBe('');
  });
});

describe('formatEpicFreeGame link building', () => {
  it('builds a store.epicgames.com product URL for the real Cardpocalypse payload', () => {
    const el = {
      title: 'Cardpocalypse Standard Edition',
      productSlug: 'cardpocalypse/home',
      urlSlug: 'cardpocalypsegeneralaudience',
      catalogNs: { mappings: [{ pageSlug: 'cardpocalypse' }] },
      offerMappings: [{ pageSlug: 'cardpocalypse' }],
      categories: [{ path: 'freegames' }, { path: 'games' }],
    } as any;
    expect(formatEpicFreeGame(el, false).link).toBe('https://store.epicgames.com/en-US/p/cardpocalypse');
  });

  it('never emits a link with an empty slug', () => {
    const link = formatEpicFreeGame({ title: 'X' } as any, false).link;
    expect(link).not.toMatch(/\/p\/?$/);
    expect(link).toBe(EPIC_FREE_GAMES_URL);
  });
});

describe('partitionEpicPromotions', () => {
  const currentlyFree = {
    title: 'Cardpocalypse Standard Edition',
    price: { totalPrice: { discountPrice: 0 } },
    promotions: {
      promotionalOffers: [{ promotionalOffers: [{ discountSetting: { discountPercentage: 0 } }] }],
    },
  } as any;

  const upcomingFree = {
    title: 'Breathedge',
    price: { totalPrice: { discountPrice: 2499 } },
    promotions: {
      upcomingPromotionalOffers: [{ promotionalOffers: [{ discountSetting: { discountPercentage: 0 } }] }],
    },
  } as any;

  const upcomingDiscount = {
    title: 'Ghostrunner 2',
    price: { totalPrice: { discountPrice: 3999 } },
    promotions: {
      upcomingPromotionalOffers: [{ promotionalOffers: [{ discountSetting: { discountPercentage: 20 } }] }],
    },
  } as any;

  it('splits current and upcoming free games', () => {
    const { current, future } = partitionEpicPromotions([currentlyFree, upcomingFree, upcomingDiscount]);
    expect(current.map((g) => g.title)).toEqual(['Cardpocalypse Standard Edition']);
    expect(future.map((g) => g.title)).toEqual(['Breathedge']);
  });

  it('never lists a currently free game as upcoming', () => {
    const alsoUpcoming = {
      ...currentlyFree,
      promotions: {
        ...currentlyFree.promotions,
        upcomingPromotionalOffers: [{ promotionalOffers: [{ discountSetting: { discountPercentage: 0 } }] }],
      },
    } as any;
    const { current, future } = partitionEpicPromotions([alsoUpcoming]);
    expect(current).toHaveLength(1);
    expect(future).toEqual([]);
  });
});

describe('claimGames resilience', () => {
  it('opens every game even when an earlier claim throws', async () => {
    const opened: string[] = [];
    const runner = Object.create(background);
    runner.openTabAndSendActionToContent = async (url: string) => {
      opened.push(url);
      if (opened.length === 1) throw new Error('Receiving end does not exist');
    };
    runner.wait = async () => {};
    runner.setBadgeText = async () => {};

    await runner.claimGames([
      { title: 'A', platform: Platforms.Epic, link: 'https://store.epicgames.com/en-US/p/a' },
      { title: 'B', platform: Platforms.Epic, link: 'https://store.epicgames.com/en-US/p/b' },
    ] as any);

    expect(opened).toHaveLength(2);
    expect(opened[1]).toContain('/p/b');
  });
});
