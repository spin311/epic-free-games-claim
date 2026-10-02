import { describe, it, expect, vi } from 'vitest';
import {
  CLAIM_RETRY_INTERVAL_MS,
  ensureLunaOriginRule,
  excludeRecentlyAttempted,
  extractCsrfToken,
  fetchPrimeLookup,
  LUNA_CLAIMS_URL,
  LUNA_GRAPHQL_URL,
  LUNA_ORIGIN_RULE_ID,
  parsePrimeLookup,
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

// Confirmed live (Oct 2026): a signed-in Prime account answers
// { isSignedIn: true, isAmazonPrime: true, isTwitchPrime: true }; a
// signed-out session answers all three false.
const PRIME_MEMBER = { isSignedIn: true, isAmazonPrime: true, isTwitchPrime: true };
const SIGNED_OUT = { isSignedIn: false, isAmazonPrime: false, isTwitchPrime: false };
const NO_PRIME = { isSignedIn: true, isAmazonPrime: false, isTwitchPrime: false };

function payload(items: unknown[], currentUser: unknown = PRIME_MEMBER) {
  return { data: { currentUser, games: { items } } };
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
      canClaim: null,
      externalPlatform: 'GOG',
    });
  });

  it("reads Amazon's own per-user canClaim from the live offer", () => {
    const [offer] = parsePrimeOffers(payload([item({ eligibility: [{ offerState: 'LIVE', isClaimed: false, canClaim: true }] })]));
    expect(offer.canClaim).toBe(true);
  });

  it('reports isClaimed null when Amazon returned no per-user eligibility', () => {
    const [offer] = parsePrimeOffers(payload([item({ eligibility: [null] })]));
    expect(offer.isClaimed).toBeNull();
  });

  // Confirmed live: Amazon Games App offers end in -aga, Legacy Games ones in -legacy.
  it('maps -aga to the Amazon Games App and -legacy to Legacy Games', () => {
    const [aga, legacy] = parsePrimeOffers(payload([
      item({ slug: 'wall-world-2-aga' }),
      item({ slug: 'the-da-vinci-cryptex-legacy' }),
    ]));
    expect(aga.externalPlatform).toBe('AmazonGames');
    expect(legacy.externalPlatform).toBe('Legacy');
  });

  it('leaves the platform null for slugs this extension does not redeem', () => {
    const [offer] = parsePrimeOffers(payload([item({ slug: 'some-game-ubisoft' })]));
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
    canClaim: null,
    externalPlatform,
  });

  it('keeps only live, not-yet-claimed offers on an enabled platform', () => {
    const offers = [
      offer('unclaimed-gog', false, 'GOG'),
      offer('claimed-gog', true, 'GOG'),
      offer('unclaimed-epic-disabled', false, 'Epic'),
      offer('unknown-state', null, 'GOG'),
      offer('unsupported-store', false, null),
      offer('expired-gog', false, 'GOG', false),
    ];

    expect(selectClaimableOffers(offers, new Set(['GOG'])).map((g) => g.title)).toEqual(['unclaimed-gog']);
  });

  it('claims Amazon Games App and Legacy Games offers once enabled', () => {
    const offers = [offer('wall-world-2', false, 'AmazonGames'), offer('cryptex', false, 'Legacy')];

    expect(selectClaimableOffers(offers, new Set(['AmazonGames', 'Legacy'])).map((g) => g.title))
        .toEqual(['wall-world-2', 'cryptex']);
  });
});

describe('parsePrimeLookup', () => {
  it('returns the offers for a signed-in Prime member', () => {
    const lookup = parsePrimeLookup(payload([item()]));
    expect(lookup.status).toBe('ok');
    expect(lookup.status === 'ok' && lookup.offers).toHaveLength(1);
  });

  // Confirmed live: a signed-out session gets every eligibility null and
  // currentUser.isSignedIn false — a definitive answer, so no claims-page tab
  // is needed to find that out.
  it('reports signed-out instead of throwing when Amazon says nobody is signed in', () => {
    expect(parsePrimeLookup(payload([item({ eligibility: [null] })], SIGNED_OUT))).toEqual({ status: 'signed-out' });
  });

  // A non-Prime account must never get claim tabs opened: "Get game" would
  // only lead to Amazon's Prime sign-up page.
  it('reports no-prime for a signed-in account without Prime', () => {
    const unclaimed = item({ eligibility: [{ offerState: 'LIVE', isClaimed: false, canClaim: false }] });
    expect(parsePrimeLookup(payload([unclaimed], NO_PRIME))).toEqual({ status: 'no-prime' });
  });

  // Luna Premium subscribers can claim without Prime; if Amazon says an offer
  // is claimable, that wins over the account-level flags.
  it('trusts an offer Amazon marks claimable even when both Prime flags are false', () => {
    const claimable = item({ eligibility: [{ offerState: 'LIVE', isClaimed: false, canClaim: true }] });
    expect(parsePrimeLookup(payload([claimable], NO_PRIME)).status).toBe('ok');
  });

  it('accepts either Prime flag as membership', () => {
    const twitchOnly = { ...NO_PRIME, isTwitchPrime: true };
    expect(parsePrimeLookup(payload([item()], twitchOnly)).status).toBe('ok');
  });

  // A missing or malformed currentUser is a schema change, not an answer:
  // fall back to the old "needs per-user claim state" rule.
  it('falls back to requiring claim state when currentUser is missing', () => {
    expect(parsePrimeLookup(payload([item()], undefined)).status).toBe('ok');
    expect(() => parsePrimeLookup(payload([item({ eligibility: [null] })], undefined))).toThrow(/claim state/i);
  });

  it('never treats a non-boolean isSignedIn as signed out', () => {
    const odd = { isSignedIn: 'false', isAmazonPrime: false, isTwitchPrime: false };
    expect(() => parsePrimeLookup(payload([item({ eligibility: [null] })], odd))).toThrow(/claim state/i);
  });
});

describe('fetchPrimeLookup', () => {
  const html = "<input type='hidden' name='csrf-key' value='TOKEN123' />";

  it('reads the csrf token from the claims page, then queries GraphQL with it', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(response(200, html))
      .mockResolvedValueOnce(response(200, payload([item()])));

    const lookup = await fetchPrimeLookup(fetchImpl);

    expect(lookup.status === 'ok' && lookup.offers).toHaveLength(1);
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

    await fetchPrimeLookup(fetchImpl);

    for (const [, init] of fetchImpl.mock.calls) expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  // An empty list can't be told apart from a signed-out/odd response, and
  // must not wipe the popup's list or mark the user signed in.
  it('throws when no offers come back at all', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(response(200, html))
      .mockResolvedValueOnce(response(200, payload([])));
    await expect(fetchPrimeLookup(fetchImpl)).rejects.toThrow(/claim state/i);
  });

  it('throws when the claims page has no csrf token', async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(response(200, '<html></html>'));
    await expect(fetchPrimeLookup(fetchImpl)).rejects.toThrow(/csrf/i);
  });

  // Confirmed live: without the Origin rule Amazon answers 403 "Invalid CORS request".
  it('throws on a non-OK GraphQL response', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(response(200, html))
      .mockResolvedValueOnce(response(403, 'Invalid CORS request'));
    await expect(fetchPrimeLookup(fetchImpl)).rejects.toThrow(/403/);
  });

  // No per-user claim state at all means we can't tell claimed from unclaimed
  // (e.g. signed out) — better to fall back than to open a tab per offer.
  it('throws when no offer carries per-user claim state', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(response(200, html))
      .mockResolvedValueOnce(response(200, payload([item({ eligibility: [null] })])));
    await expect(fetchPrimeLookup(fetchImpl)).rejects.toThrow(/claim state/i);
  });

  it("asks for the account's sign-in and Prime state in the same request", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(response(200, html))
      .mockResolvedValueOnce(response(200, payload([item({ eligibility: [null] })], SIGNED_OUT)));

    expect(await fetchPrimeLookup(fetchImpl)).toEqual({ status: 'signed-out' });
    const body = JSON.parse(fetchImpl.mock.calls[1][1].body);
    expect(body.query).toMatch(/currentUser\s*{\s*isSignedIn isAmazonPrime isTwitchPrime\s*}/);
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
