import { describe, it, expect, vi } from 'vitest';
import {
  CLAIM_RETRY_INTERVAL_MS,
  ensureLunaOriginRule,
  excludeRecentlyAttempted,
  extractCsrfToken,
  fetchPrimeOffers,
  LUNA_CLAIMS_URL,
  LUNA_GRAPHQL_URL,
  LUNA_ORIGIN_RULE_ID,
  parsePrimeOffers,
  PrimeOffer,
  selectClaimableOffers,
  updateClaimAttempts,
} from './primeGamingApi';
import { Platforms } from '@/entrypoints/enums/platforms.ts';

// Shapes below mirror a live OffersContext response (Oct 2026), trimmed.
function item(overrides: { title?: string; slug?: string; id?: string; eligibility?: unknown[] } = {}) {
  const id = overrides.id ?? 'amzn1.pg.item.b095156c-1207-49f0-801a-75ac03b74def';
  const slug = overrides.slug ?? 'doom-gog';
  return {
    id,
    assets: {
      title: overrides.title ?? 'DOOM',
      externalClaimLink: `https://gaming.amazon.com/${slug}/dp/${id}?ref_=SM_DOOM_S01_FGWP_CRWN`,
      cardMedia: { defaultMedia: { src1x: 'https://m.media-amazon.com/images/I/719F0.jpg' } },
    },
    offers: (overrides.eligibility ?? [{ offerState: 'LIVE', isClaimed: false }]).map((eligibility) => ({
      offerSelfConnection: { eligibility },
    })),
  };
}

function payload(items: unknown[]) {
  return { data: { games: { items } } };
}

function response(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: () => Promise.resolve(typeof body === 'string' ? body : JSON.stringify(body)),
  } as Response;
}

describe('extractCsrfToken', () => {
  // Confirmed live: single-quoted, self-closing, base64 value.
  it("reads the csrf-key input's value", () => {
    const html = "<input type='hidden' name='csrf-key' value='gtqn+5JSwK/no8wd99BZ==' />";
    expect(extractCsrfToken(html)).toBe('gtqn+5JSwK/no8wd99BZ==');
  });

  it('accepts double quotes and value-before-name order', () => {
    expect(extractCsrfToken('<input value="abc123" type="hidden" name="csrf-key">')).toBe('abc123');
  });

  it('returns null when the page has no csrf-key input', () => {
    expect(extractCsrfToken('<html><body>Sign in</body></html>')).toBeNull();
  });
});

describe('parsePrimeOffers', () => {
  it('maps an item to a Luna claim-page game with its claim state and platform', () => {
    const [offer] = parsePrimeOffers(payload([item({ eligibility: [{ offerState: 'LIVE', isClaimed: true }] })]));

    expect(offer).toEqual<PrimeOffer>({
      game: {
        title: 'DOOM',
        platform: Platforms.PrimeGaming,
        // The content script's details-page flow lives on luna.amazon.com.
        link: 'https://luna.amazon.com/claims/doom-gog/dp/amzn1.pg.item.b095156c-1207-49f0-801a-75ac03b74def',
        img: 'https://m.media-amazon.com/images/I/719F0.jpg',
      },
      isClaimed: true,
      isLive: true,
      externalPlatform: 'GOG',
    });
  });

  it('reports isClaimed null when Amazon returned no per-user eligibility', () => {
    const [offer] = parsePrimeOffers(payload([item({ eligibility: [null] })]));
    expect(offer.isClaimed).toBeNull();
  });

  it('leaves the platform null for slugs this extension does not redeem (e.g. -aga, -legacy)', () => {
    const [offer] = parsePrimeOffers(payload([item({ slug: 'wall-world-2-aga' })]));
    expect(offer.externalPlatform).toBeNull();
  });

  it('skips items without a title', () => {
    const broken = { id: 'x', assets: { title: '' }, offers: [] };
    expect(parsePrimeOffers(payload([broken, item()]))).toHaveLength(1);
  });

  // Still listed for the popup, never claimed: there's no page to claim it on.
  it('keeps an item without a usable claim link, unclaimable', () => {
    const noLink = { ...item({ title: 'Mystery' }), assets: { title: 'Mystery' } };
    const [offer] = parsePrimeOffers(payload([noLink]));
    expect(offer.game.link).toBe(LUNA_CLAIMS_URL);
    expect(offer.externalPlatform).toBeNull();
  });

  // A partial schema change must not read as "unclaimed" and claim everything.
  it('treats an eligibility whose isClaimed is not a boolean as unknown', () => {
    const [offer] = parsePrimeOffers(payload([item({ eligibility: [{ offerState: 'LIVE', isClaimed: null }] })]));
    expect(offer.isClaimed).toBeNull();
  });

  it("reads the claim state from the live offer, not an older claimed one", () => {
    const [offer] = parsePrimeOffers(payload([item({ eligibility: [
      { offerState: 'EXPIRED', isClaimed: true },
      { offerState: 'LIVE', isClaimed: false },
    ] })]));
    expect(offer.isClaimed).toBe(false);
    expect(offer.isLive).toBe(true);
  });

  it('throws on an unexpected payload shape so the caller can fall back', () => {
    expect(() => parsePrimeOffers({ errors: [{ message: 'nope' }] })).toThrow();
  });
});

describe('selectClaimableOffers', () => {
  const offer = (title: string, isClaimed: boolean | null, externalPlatform: PrimeOffer['externalPlatform'], isLive = true): PrimeOffer => ({
    game: { title, platform: Platforms.PrimeGaming, link: `https://luna.amazon.com/claims/${title}/dp/x`, img: '' },
    isClaimed,
    isLive,
    externalPlatform,
  });

  it('keeps only live, not-yet-claimed offers on an enabled platform', () => {
    const offers = [
      offer('unclaimed-gog', false, 'GOG'),
      offer('claimed-gog', true, 'GOG'),
      offer('unclaimed-epic-disabled', false, 'Epic'),
      offer('unknown-state', null, 'GOG'),
      offer('unsupported-aga', false, null),
      offer('expired-gog', false, 'GOG', false),
    ];

    expect(selectClaimableOffers(offers, new Set(['GOG'])).map((g) => g.title)).toEqual(['unclaimed-gog']);
  });
});

describe('fetchPrimeOffers', () => {
  const html = "<input type='hidden' name='csrf-key' value='TOKEN123' />";

  it('reads the csrf token from the claims page, then queries GraphQL with it', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(response(200, html))
      .mockResolvedValueOnce(response(200, payload([item()])));

    const offers = await fetchPrimeOffers(fetchImpl);

    expect(offers).toHaveLength(1);
    expect(fetchImpl).toHaveBeenNthCalledWith(1, LUNA_CLAIMS_URL, expect.objectContaining({ credentials: 'include' }));
    expect(fetchImpl).toHaveBeenNthCalledWith(2, LUNA_GRAPHQL_URL, expect.objectContaining({
      method: 'POST',
      credentials: 'include',
      headers: expect.objectContaining({ 'csrf-token': 'TOKEN123', 'client-id': 'CarboniteApp' }),
    }));
  });

  it('bounds both requests with a timeout', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(response(200, html))
      .mockResolvedValueOnce(response(200, payload([item()])));

    await fetchPrimeOffers(fetchImpl);

    for (const [, init] of fetchImpl.mock.calls) expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  // An empty list can't be told apart from a signed-out/odd response, and
  // must not wipe the popup's list or mark the user signed in.
  it('throws when no offers come back at all', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(response(200, html))
      .mockResolvedValueOnce(response(200, payload([])));
    await expect(fetchPrimeOffers(fetchImpl)).rejects.toThrow(/claim state/i);
  });

  it('throws when the claims page has no csrf token', async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(response(200, '<html></html>'));
    await expect(fetchPrimeOffers(fetchImpl)).rejects.toThrow(/csrf/i);
  });

  // Confirmed live: without the Origin rule Amazon answers 403 "Invalid CORS request".
  it('throws on a non-OK GraphQL response', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(response(200, html))
      .mockResolvedValueOnce(response(403, 'Invalid CORS request'));
    await expect(fetchPrimeOffers(fetchImpl)).rejects.toThrow(/403/);
  });

  // No per-user claim state at all means we can't tell claimed from unclaimed
  // (e.g. signed out) — better to fall back than to open a tab per offer.
  it('throws when no offer carries per-user claim state', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(response(200, html))
      .mockResolvedValueOnce(response(200, payload([item({ eligibility: [null] })])));
    await expect(fetchPrimeOffers(fetchImpl)).rejects.toThrow(/claim state/i);
  });
});

describe('ensureLunaOriginRule', () => {
  it("(re)installs a session rule that sets Luna's Origin on this extension's GraphQL requests only", async () => {
    const updateSessionRules = vi.fn().mockResolvedValue(undefined);

    await ensureLunaOriginRule({ updateSessionRules }, 'abcdefghijklmnop');

    expect(updateSessionRules).toHaveBeenCalledWith({
      removeRuleIds: [LUNA_ORIGIN_RULE_ID],
      addRules: [expect.objectContaining({
        id: LUNA_ORIGIN_RULE_ID,
        action: {
          type: 'modifyHeaders',
          requestHeaders: [{ header: 'origin', operation: 'set', value: 'https://luna.amazon.com' }],
        },
        condition: expect.objectContaining({
          urlFilter: `|${LUNA_GRAPHQL_URL}|`,
          initiatorDomains: ['abcdefghijklmnop'],
        }),
      })],
    });
  });

  it('throws when the browser has no declarativeNetRequest support', async () => {
    await expect(ensureLunaOriginRule(undefined, 'abc')).rejects.toThrow(/declarativeNetRequest/);
  });
});

describe('claim retry cooldown', () => {
  const now = new Date('2026-10-02T12:00:00Z');
  const game = (title: string) => ({ title, platform: Platforms.PrimeGaming, link: `https://luna.amazon.com/claims/${title}/dp/x`, img: '' });

  // Regression guard: an offer whose claim can't finish (e.g. Epic not
  // linked) stays "unclaimed" — without a cooldown an hourly schedule
  // reopened its tab every hour.
  it('skips offers attempted within the retry interval', () => {
    const attempts = {
      [game('recent').link]: new Date(now.getTime() - 60 * 60 * 1000).toISOString(),
      [game('stale').link]: new Date(now.getTime() - CLAIM_RETRY_INTERVAL_MS - 1).toISOString(),
    };

    const kept = excludeRecentlyAttempted([game('recent'), game('stale'), game('never')], attempts, now);

    expect(kept.map((g) => g.title)).toEqual(['stale', 'never']);
  });

  it('records new attempts and forgets offers that are no longer listed', () => {
    const attempts = { 'https://old/expired': '2026-09-01T00:00:00.000Z', [game('kept').link]: '2026-10-01T00:00:00.000Z' };

    const next = updateClaimAttempts(attempts, [game('new')], [game('kept'), game('new')], now);

    expect(next).toEqual({
      [game('kept').link]: '2026-10-01T00:00:00.000Z',
      [game('new').link]: now.toISOString(),
    });
    expect(attempts).toHaveProperty(['https://old/expired']); // input left untouched
  });
});
