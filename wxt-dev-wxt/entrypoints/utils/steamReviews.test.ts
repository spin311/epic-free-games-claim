import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  parseSteamAppId,
  calculatePositivePercent,
  meetsPositiveThreshold,
  parseThresholdInput,
  fetchSteamPositivePercent,
  shouldClaimSteamGame,
  STEAM_REVIEW_TIERS,
  findTierLabelForThreshold,
  parsePagePositivePercent,
  resolvePositivePercent,
} from './steamReviews';

// Trimmed from the real store page for app 674750, keeping every review figure
// it shows: recent (30d), the viewer's language, and the all-languages total.
const PAGE_WITH_BREAKDOWN = `
<div id="userReviews" class="user_reviews">
  <a class="user_reviews_summary_row" data-tooltip-html="68% of the 22 user reviews in the last 30 days are positive.">
    <div class="subtitle column">Recent Reviews:</div>
    <div class="summary column"><span class="game_review_summary mixed">Mixed</span></div>
  </a>
  <a class="user_reviews_summary_row" data-tooltip-html="82% of the 550 user reviews in your language are positive">
    <div class="subtitle column all">English Reviews:</div>
    <div class="summary column"><span class="game_review_summary positive">Very Positive</span></div>
  </a>
</div>
<div class="review_language_breakdown">
  <div class="outlier_totals global review_box_background_secondary">
    Total reviews in all languages: <span class="review_summary_count">2,555</span>
    <span class="game_review_summary positive"
          data-tooltip-html="84% of the 2,555 user reviews for this game are positive.">Very Positive</span>
  </div>
</div>`;

// Games with a single language show no breakdown block — their one "All
// Reviews" row already IS the all-languages figure.
const PAGE_WITHOUT_BREAKDOWN = `
<div id="userReviews" class="user_reviews">
  <a class="user_reviews_summary_row" data-tooltip-html="91% of the 1,244,814 user reviews for this game are positive.">
    <div class="subtitle column all">All Reviews:</div>
    <div class="summary column"><span class="game_review_summary positive">Very Positive</span></div>
  </a>
</div>`;

const AGE_GATE_PAGE = `
<div id="app_agegate"><h2>Content Warning</h2>
  <div class="agegate_birthday_selector">Please enter your birth date</div>
</div>`;

function summaryResponse(summary: Record<string, number>, success = 1) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ success, query_summary: summary }),
  } as unknown as Response;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('STEAM_REVIEW_TIERS', () => {
  it('offers exactly the supported thresholds, strictest first', () => {
    expect(STEAM_REVIEW_TIERS.map(t => t.threshold)).toEqual([90, 80, 70, 60, 50, 40, 20]);
  });

  // Thresholds are unique, so the number alone can key the dropdown — no
  // label-based lookup and no ambiguity when two bands share a low end.
  it('has a unique threshold per entry', () => {
    const thresholds = STEAM_REVIEW_TIERS.map(t => t.threshold);
    expect(new Set(thresholds).size).toBe(thresholds.length);
  });

  it('keeps every threshold inside 0-100', () => {
    for (const tier of STEAM_REVIEW_TIERS) {
      expect(tier.threshold).toBeGreaterThanOrEqual(0);
      expect(tier.threshold).toBeLessThanOrEqual(100);
      expect(tier.label).not.toBe('');
    }
  });
});

describe('findTierLabelForThreshold', () => {
  it('labels a threshold with the Steam band that contains it', () => {
    expect(findTierLabelForThreshold(90)).toBe('Very Positive');
    expect(findTierLabelForThreshold(80)).toBe('Very Positive');
    expect(findTierLabelForThreshold(70)).toBe('Mostly Positive');
    expect(findTierLabelForThreshold(20)).toBe('Mostly Negative');
  });

  // 40/50/60 all sit inside Steam's single "Mixed" band (40-69%), so they
  // share a label while staying distinct thresholds.
  it('labels every mid-band threshold Mixed', () => {
    expect(findTierLabelForThreshold(60)).toBe('Mixed');
    expect(findTierLabelForThreshold(50)).toBe('Mixed');
    expect(findTierLabelForThreshold(40)).toBe('Mixed');
  });

  it('is blank for a number no preset uses, so the dropdown shows Custom', () => {
    expect(findTierLabelForThreshold(73)).toBe('');
    expect(findTierLabelForThreshold(95)).toBe('');
  });

  it('is blank when no threshold is set', () => {
    expect(findTierLabelForThreshold(null)).toBe('');
  });
});

describe('parseSteamAppId', () => {
  it('extracts the id from a canonical store URL', () => {
    expect(parseSteamAppId('https://store.steampowered.com/app/440/Team_Fortress_2/')).toBe(440);
  });

  it('extracts the id when no slug follows', () => {
    expect(parseSteamAppId('https://store.steampowered.com/app/2537590')).toBe(2537590);
  });

  it('ignores query strings and fragments', () => {
    expect(parseSteamAppId('https://store.steampowered.com/app/440/?snr=1_7#reviews')).toBe(440);
  });

  it('is null for a non-app store URL', () => {
    expect(parseSteamAppId('https://store.steampowered.com/search/?maxprice=free')).toBeNull();
  });

  it('is null for garbage input', () => {
    expect(parseSteamAppId('')).toBeNull();
    expect(parseSteamAppId('not a url')).toBeNull();
  });
});

describe('calculatePositivePercent', () => {
  it('computes the lifetime positive share', () => {
    const percent = calculatePositivePercent({ total_positive: 1132865, total_reviews: 1244814 });
    expect(percent).toBeCloseTo(91.0, 1);
  });

  it('is 100 when every review is positive', () => {
    expect(calculatePositivePercent({ total_positive: 20, total_reviews: 20 })).toBe(100);
  });

  it('is 0 when no review is positive', () => {
    expect(calculatePositivePercent({ total_positive: 0, total_reviews: 15 })).toBe(0);
  });

  // A reviewless game has no percentage at all — that is NOT the same as 0%.
  it('is null when the game has no reviews', () => {
    expect(calculatePositivePercent({ total_positive: 0, total_reviews: 0 })).toBeNull();
  });

  it('is null when the summary is missing or malformed', () => {
    expect(calculatePositivePercent(undefined)).toBeNull();
    expect(calculatePositivePercent(null)).toBeNull();
    expect(calculatePositivePercent({})).toBeNull();
  });
});

describe('meetsPositiveThreshold', () => {
  it('passes everything when no threshold is set', () => {
    expect(meetsPositiveThreshold(12, null)).toBe(true);
    expect(meetsPositiveThreshold(null, null)).toBe(true);
  });

  it('passes when the percentage is above the threshold', () => {
    expect(meetsPositiveThreshold(91, 70)).toBe(true);
  });

  it('passes on an exact match', () => {
    expect(meetsPositiveThreshold(70, 70)).toBe(true);
  });

  it('fails when the percentage is below the threshold', () => {
    expect(meetsPositiveThreshold(58.7, 70)).toBe(false);
  });

  // Decided behavior: a confirmed reviewless game cannot clear a bar the user set.
  it('fails an unknown percentage when a threshold is set', () => {
    expect(meetsPositiveThreshold(null, 70)).toBe(false);
  });
});

describe('parseThresholdInput', () => {
  it('treats a blank field as no threshold', () => {
    expect(parseThresholdInput('')).toBeNull();
    expect(parseThresholdInput('   ')).toBeNull();
  });

  it('treats non-numeric input as no threshold', () => {
    expect(parseThresholdInput('abc')).toBeNull();
  });

  it('accepts a plain percentage', () => {
    expect(parseThresholdInput('70')).toBe(70);
  });

  it('accepts zero', () => {
    expect(parseThresholdInput('0')).toBe(0);
  });

  it('clamps above 100 and below 0', () => {
    expect(parseThresholdInput('150')).toBe(100);
    expect(parseThresholdInput('-5')).toBe(0);
  });
});

describe('fetchSteamPositivePercent', () => {
  it('returns the computed percentage on a successful lookup', async () => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      summaryResponse({ total_positive: 12573, total_reviews: 21405 })
    ));
    const percent = await fetchSteamPositivePercent(2537590);
    expect(percent).toBeCloseTo(58.7, 1);
  });

  it('requests the all-language, all-purchase-type summary', async () => {
    const fetchMock = vi.fn(async (_url: string) =>
      summaryResponse({ total_positive: 1, total_reviews: 2 })
    );
    vi.stubGlobal('fetch', fetchMock);
    await fetchSteamPositivePercent(440);
    const url = fetchMock.mock.calls[0][0];
    expect(url).toContain('/appreviews/440');
    expect(url).toContain('language=all');
    expect(url).toContain('purchase_type=all');
  });

  it('returns null for a game Steam confirms has no reviews', async () => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      summaryResponse({ total_positive: 0, total_reviews: 0 })
    ));
    expect(await fetchSteamPositivePercent(9999999)).toBeNull();
  });

  it('throws on an HTTP error so callers can tell an outage from a verdict', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 503 } as unknown as Response)));
    await expect(fetchSteamPositivePercent(440)).rejects.toThrow(/503/);
  });

  it('throws when Steam reports the query itself failed', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => summaryResponse({}, 0)));
    await expect(fetchSteamPositivePercent(440)).rejects.toThrow();
  });

  it('throws when the response body is not usable JSON', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => { throw new SyntaxError('Unexpected token <'); },
    } as unknown as Response)));
    await expect(fetchSteamPositivePercent(440)).rejects.toThrow();
  });
});

describe('parsePagePositivePercent', () => {
  // The gate uses Steam's all-languages lifetime score, NOT the 30-day recent
  // figure (68% here) and NOT the viewer's-language one (82% here).
  it('reads the all-languages total, ignoring recent and per-language rows', () => {
    expect(parsePagePositivePercent(PAGE_WITH_BREAKDOWN)).toBe(84);
  });

  it('falls back to the single All Reviews row when no breakdown block exists', () => {
    expect(parsePagePositivePercent(PAGE_WITHOUT_BREAKDOWN)).toBe(91);
  });

  // Mature games serve an age-gate interstitial instead of the store page.
  it('is null for an age-gate interstitial', () => {
    expect(parsePagePositivePercent(AGE_GATE_PAGE)).toBeNull();
  });

  it('is null for markup with no review summary at all', () => {
    expect(parsePagePositivePercent('<div>store is down</div>')).toBeNull();
    expect(parsePagePositivePercent('')).toBeNull();
  });

  it('is null when the tooltip carries no percentage', () => {
    expect(parsePagePositivePercent(`
      <div class="review_language_breakdown"><div class="outlier_totals global">
        <span class="game_review_summary" data-tooltip-html="Need more user reviews">No reviews</span>
      </div></div>`)).toBeNull();
  });
});

// Routes page requests (text) and API requests (json) to different bodies so
// the page-first / API-fallback order can be asserted.
function stubSteam({ page, api }: { page?: string | Error; api?: Response | Error }) {
  const calls: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    calls.push(url);
    if (url.includes('/appreviews/')) {
      if (api instanceof Error) throw api;
      if (!api) throw new Error('unexpected API call');
      return api;
    }
    if (page instanceof Error) throw page;
    return { ok: true, status: 200, text: async () => page ?? '' } as unknown as Response;
  }));
  return calls;
}

describe('resolvePositivePercent', () => {
  it('prefers the store page score and never calls the API', async () => {
    const calls = stubSteam({ page: PAGE_WITH_BREAKDOWN });
    expect(await resolvePositivePercent(674750)).toBe(84);
    expect(calls.some(u => u.includes('/appreviews/'))).toBe(false);
  });

  it('falls back to the API when the page has no parsable score', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const calls = stubSteam({
      page: AGE_GATE_PAGE,
      api: summaryResponse({ total_positive: 82, total_reviews: 100 }),
    });
    expect(await resolvePositivePercent(674750)).toBe(82);
    expect(calls.some(u => u.includes('/appreviews/'))).toBe(true);
  });

  it('falls back to the API when the page fetch itself fails', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    stubSteam({
      page: new TypeError('network down'),
      api: summaryResponse({ total_positive: 75, total_reviews: 100 }),
    });
    expect(await resolvePositivePercent(674750)).toBe(75);
  });

  it('propagates the API failure when both sources fail', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    stubSteam({ page: new TypeError('page down'), api: new TypeError('api down') });
    await expect(resolvePositivePercent(674750)).rejects.toThrow(/api down/);
  });
});

describe('shouldClaimSteamGame', () => {
  const LINK = 'https://store.steampowered.com/app/674750/Yet_Another_Zombie_Defense_HD/';

  it('claims without any lookup when no threshold is set', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    expect(await shouldClaimSteamGame(LINK, null)).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  // The worked example: page shows 84% all-languages, so a 70 bar passes and a
  // 90 bar does not — the 68% recent figure is deliberately not consulted.
  it('claims when the page score clears the threshold', async () => {
    stubSteam({ page: PAGE_WITH_BREAKDOWN });
    expect(await shouldClaimSteamGame(LINK, 70)).toBe(true);
  });

  it('skips when the page score is below the threshold', async () => {
    stubSteam({ page: PAGE_WITH_BREAKDOWN });
    expect(await shouldClaimSteamGame(LINK, 90)).toBe(false);
  });

  it('skips a game Steam confirms has no reviews', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    stubSteam({
      page: '<div>no reviews yet</div>',
      api: summaryResponse({ total_positive: 0, total_reviews: 0 }),
    });
    expect(await shouldClaimSteamGame(LINK, 70)).toBe(false);
  });

  // Fail open: a Steam outage is our failure, and free promos are time-limited.
  it('claims anyway when both lookups error out', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    stubSteam({ page: new TypeError('page down'), api: new TypeError('api down') });
    expect(await shouldClaimSteamGame(LINK, 70)).toBe(true);
  });

  it('claims anyway when the link has no recognizable appid', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(await shouldClaimSteamGame('https://store.steampowered.com/sale/winter', 70)).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
