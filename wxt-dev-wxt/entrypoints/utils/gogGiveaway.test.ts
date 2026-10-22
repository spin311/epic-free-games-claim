import { describe, it, expect, vi } from 'vitest';
import {
  buildRedeemUrl,
  extractRedeemCodeParam,
  GOG_CLAIM_URL,
  GOG_HOME_URL,
  GOG_REDEEM_URL,
  GOG_STATUS_URL,
  GOG_OWNED_GAMES_URL,
  claimGiveaway,
  fetchGiveaway,
  fetchOwnedGameIds,
  parseGiveawayStatus,
  hasRedeemSuccessScreen,
  waitForRedeemConfirmation,
} from './gogGiveaway';
import { Platforms } from '@/entrypoints/enums/platforms.ts';

describe('buildRedeemUrl', () => {
  it('builds a gog.com/redeem URL carrying the code as a query param', () => {
    expect(buildRedeemUrl('YRXG7D62AF07ADCE5B'))
      .toBe(`${GOG_REDEEM_URL}?extCode=YRXG7D62AF07ADCE5B`);
  });

  it('also carries the title as a query param when given', () => {
    const url = new URL(buildRedeemUrl('YRXG7D62AF07ADCE5B', 'DOOM + DOOM II'));
    expect(url.searchParams.get('extTitle')).toBe('DOOM + DOOM II');
  });
});

describe('extractRedeemCodeParam', () => {
  it('reads the code back out of the query string', () => {
    expect(extractRedeemCodeParam('?extCode=YRXG7D62AF07ADCE5B')).toBe('YRXG7D62AF07ADCE5B');
  });

  it('returns null when the param is absent', () => {
    expect(extractRedeemCodeParam('')).toBeNull();
    expect(extractRedeemCodeParam('?other=1')).toBeNull();
  });
});

// Builds a minimal Response-like stub; the helpers only touch these members.
function response(status: number, body: unknown, ok = status >= 200 && status < 300) {
  return {
    ok,
    status,
    text: () => Promise.resolve(typeof body === 'string' ? body : JSON.stringify(body)),
  } as Response;
}

describe('parseGiveawayStatus', () => {
  it('returns null when there is no payload at all', () => {
    expect(parseGiveawayStatus(null)).toBeNull();
    expect(parseGiveawayStatus(undefined)).toBeNull();
    expect(parseGiveawayStatus('')).toBeNull();
    expect(parseGiveawayStatus(0)).toBeNull();
    expect(parseGiveawayStatus([])).toBeNull();
  });

  it('returns null for an empty object, which is how GOG reports "no giveaway running"', () => {
    expect(parseGiveawayStatus({})).toBeNull();
  });

  it('returns null for an error envelope rather than treating it as a game', () => {
    expect(parseGiveawayStatus({ message: 'Unauthorized' })).toBeNull();
  });

  it('returns null when the giveaway key is explicitly empty', () => {
    expect(parseGiveawayStatus({ giveaway: null })).toBeNull();
  });

  it('reads a flat giveaway payload', () => {
    const game = parseGiveawayStatus({
      id: '1940274368',
      title: 'Knytt Classic',
      slug: 'knytt_classic',
    });

    expect(game).toEqual({
      title: 'Knytt Classic',
      platform: Platforms.GOG,
      link: 'https://www.gog.com/en/game/knytt_classic',
      img: '/icon/128.png',
    });
  });

  it('unwraps a payload nested under "giveaway"', () => {
    const game = parseGiveawayStatus({
      giveaway: { id: '42', title: 'Some Game', slug: 'some_game' },
    });

    expect(game?.title).toBe('Some Game');
    expect(game?.link).toBe('https://www.gog.com/en/game/some_game');
  });

  it('unwraps a payload nested under "data"', () => {
    const game = parseGiveawayStatus({ data: { id: '42', title: 'Some Game' } });

    expect(game?.title).toBe('Some Game');
  });

  it('prefers an explicit store link over one derived from the slug', () => {
    const game = parseGiveawayStatus({
      title: 'Some Game',
      slug: 'some_game',
      storeLink: 'https://www.gog.com/en/game/actual_slug',
    });

    expect(game?.link).toBe('https://www.gog.com/en/game/actual_slug');
  });

  it('accepts alternative title keys GOG might use', () => {
    expect(parseGiveawayStatus({ id: '1', name: 'By Name' })?.title).toBe('By Name');
    expect(parseGiveawayStatus({ id: '1', productTitle: 'By Product' })?.title).toBe('By Product');
    expect(parseGiveawayStatus({ product: { title: 'By Nested' } })?.title).toBe('By Nested');
  });

  it('derives a readable title from the slug when no title field is present', () => {
    expect(parseGiveawayStatus({ id: '1', slug: 'knytt_classic' })?.title).toBe('Knytt Classic');
  });

  // The success shape of /giveaway/status is unverified (it needs a signed-in
  // session AND a live giveaway). A payload we only partly understand must
  // still produce a claimable game — missing a free game is the worse failure.
  it('still yields a claimable game when only an id is recognised', () => {
    const game = parseGiveawayStatus({ id: '1940274368' });

    expect(game).not.toBeNull();
    expect(game?.title).toBe('GOG Giveaway');
    expect(game?.link).toBe(GOG_HOME_URL);
  });

  it('picks up cover art when the payload carries any', () => {
    const url = 'https://images.gog-statics.com/cover.jpg';
    expect(parseGiveawayStatus({ id: '1', coverHorizontal: url })?.img).toBe(url);
    expect(parseGiveawayStatus({ id: '1', image: url })?.img).toBe(url);
  });

  it('picks up a description when the payload carries any', () => {
    expect(parseGiveawayStatus({ id: '1', description: 'A classic platformer.' })?.description)
      .toBe('A classic platformer.');
    expect(parseGiveawayStatus({ id: '1', summary: 'Short blurb.' })?.description)
      .toBe('Short blurb.');
    expect(parseGiveawayStatus({ id: '1', product: { description: 'Nested blurb.' } })?.description)
      .toBe('Nested blurb.');
  });

  it('omits description entirely rather than an empty string when absent', () => {
    const game = parseGiveawayStatus({ id: '1', title: 'Some Game' });
    expect(game).not.toHaveProperty('description');
  });
});

describe('fetchGiveaway', () => {
  it('requests the status endpoint with credentials so the session cookie is sent', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(response(200, {}));

    await fetchGiveaway(fetchImpl);

    expect(fetchImpl).toHaveBeenCalledWith(
      GOG_STATUS_URL,
      expect.objectContaining({ credentials: 'include' })
    );
  });

  it('reports unauthorized without a game on 401', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(response(401, { message: 'Unauthorized' }));

    await expect(fetchGiveaway(fetchImpl)).resolves.toEqual({ unauthorized: true, game: null });
  });

  it('treats 403 as unauthorized too', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(response(403, { message: 'Forbidden' }));

    await expect(fetchGiveaway(fetchImpl)).resolves.toEqual({ unauthorized: true, game: null });
  });

  it('returns no game when a signed-in session has no giveaway running', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(response(200, {}));

    await expect(fetchGiveaway(fetchImpl)).resolves.toEqual({ unauthorized: false, game: null });
  });

  // Confirmed live: the endpoint 404s when no giveaway is running, rather
  // than answering 200 with an empty body — same "nothing to report" outcome
  // as the case above, not a transport failure worth throwing over.
  it('treats a 404 as "no giveaway running" rather than throwing', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(response(404, 'Not Found', false));

    await expect(fetchGiveaway(fetchImpl)).resolves.toEqual({ unauthorized: false, game: null });
  });

  it('returns the parsed game when a giveaway is running', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(response(200, { id: '1', title: 'Knytt Classic', slug: 'knytt_classic' }));

    const result = await fetchGiveaway(fetchImpl);

    expect(result.unauthorized).toBe(false);
    expect(result.game?.title).toBe('Knytt Classic');
  });

  it('throws on a server error so the caller can fall back to a real page', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(response(500, 'boom'));

    await expect(fetchGiveaway(fetchImpl)).rejects.toThrow(/500/);
  });

  it('throws when the body is not JSON, rather than silently reporting no giveaway', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(response(200, '<!doctype html><html></html>'));

    await expect(fetchGiveaway(fetchImpl)).rejects.toThrow();
  });
});

describe('claimGiveaway', () => {
  it('GETs the claim endpoint with credentials', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(response(200, {}));

    await claimGiveaway(fetchImpl);

    expect(fetchImpl).toHaveBeenCalledWith(
      GOG_CLAIM_URL,
      expect.objectContaining({ credentials: 'include', method: 'GET' })
    );
  });

  it('reports a successful claim for GOG\'s empty-object response', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(response(200, {}));

    await expect(claimGiveaway(fetchImpl)).resolves.toBe('claimed');
  });

  it('reports a successful claim for a completely empty body', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(response(200, ''));

    await expect(claimGiveaway(fetchImpl)).resolves.toBe('claimed');
  });

  it('distinguishes an already-claimed giveaway from a fresh claim', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(response(200, { message: 'Already claimed' }));

    await expect(claimGiveaway(fetchImpl)).resolves.toBe('already-claimed');
  });

  it('reports unauthorized on 401', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(response(401, { message: 'Unauthorized' }));

    await expect(claimGiveaway(fetchImpl)).resolves.toBe('unauthorized');
  });

  it('reports failure on a server error instead of throwing', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(response(500, 'boom'));

    await expect(claimGiveaway(fetchImpl)).resolves.toBe('failed');
  });

  it('reports failure when the request itself rejects', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('offline'));

    await expect(claimGiveaway(fetchImpl)).resolves.toBe('failed');
  });

  it('reports failure for an unrecognised message rather than counting a claim', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(response(200, { message: 'Giveaway has ended' }));

    await expect(claimGiveaway(fetchImpl)).resolves.toBe('failed');
  });
});

describe('fetchOwnedGameIds', () => {
  // Confirmed live: same-origin endpoint answering {"owned": number[]}.
  it('returns the owned product ids, sending the session cookie', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(response(200, { owned: [1111421371, 1207658755] }));

    const owned = await fetchOwnedGameIds(fetchImpl);

    expect(owned).toEqual(new Set([1111421371, 1207658755]));
    expect(fetchImpl).toHaveBeenCalledWith(
      GOG_OWNED_GAMES_URL,
      expect.objectContaining({ credentials: 'include' })
    );
  });

  it('returns null on a non-OK response', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(response(401, { message: 'Unauthorized' }));

    await expect(fetchOwnedGameIds(fetchImpl)).resolves.toBeNull();
  });

  it('returns null when the payload has no owned array', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(response(200, '<html>login</html>'));

    await expect(fetchOwnedGameIds(fetchImpl)).resolves.toBeNull();
  });

  it('returns null when the request itself fails', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));

    await expect(fetchOwnedGameIds(fetchImpl)).resolves.toBeNull();
  });
});

describe('hasRedeemSuccessScreen', () => {
  // Confirmed live (redeem bundle + success page): GOG's success step renders
  // a .success-message header, independent of the UI language.
  it('is true when GOG renders its success message', () => {
    document.body.innerHTML = '<form><div class="success-message">Code redeemed successfully!</div></form>';
    expect(hasRedeemSuccessScreen(document)).toBe(true);
  });

  it('is false on the code-entry / confirmation steps', () => {
    document.body.innerHTML = '<form><h1>Redeem code</h1><button>Redeem</button></form>';
    expect(hasRedeemSuccessScreen(document)).toBe(false);
  });
});

describe('waitForRedeemConfirmation', () => {
  const before = new Set([1, 2]);
  const noSuccessScreen = () => false;

  it('returns true once a product id not owned before shows up', async () => {
    const fetchOwned = vi.fn()
      .mockResolvedValueOnce(new Set([1, 2]))
      .mockResolvedValueOnce(new Set([1, 2, 1367161365]));

    await expect(waitForRedeemConfirmation(before, fetchOwned, noSuccessScreen, vi.fn(async () => {}))).resolves.toBe(true);
    expect(fetchOwned).toHaveBeenCalledTimes(2);
  });

  it('keeps polling past a failed lookup', async () => {
    const fetchOwned = vi.fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(new Set([1, 2, 3]));

    await expect(waitForRedeemConfirmation(before, fetchOwned, noSuccessScreen, vi.fn(async () => {}))).resolves.toBe(true);
  });

  it('returns false when nothing new appears before the timeout', async () => {
    const fetchOwned = vi.fn().mockResolvedValue(new Set([1, 2]));

    await expect(waitForRedeemConfirmation(before, fetchOwned, noSuccessScreen, vi.fn(async () => {}), 3000, 1000)).resolves.toBe(false);
    expect(fetchOwned).toHaveBeenCalledTimes(3);
  });

  // GOG warns the library can lag behind a redeem ("might take a little
  // longer to appear in your Owned Games"), so its own success screen must
  // be enough on its own.
  it('returns true on GOG\'s success screen without waiting for the library', async () => {
    const fetchOwned = vi.fn().mockResolvedValue(new Set([1, 2]));

    await expect(waitForRedeemConfirmation(before, fetchOwned, () => true, vi.fn(async () => {}))).resolves.toBe(true);
    expect(fetchOwned).not.toHaveBeenCalled();
  });

  // gog.content.ts uses a zero timeout for a "not-redeemed" button flow:
  // one look, no waiting.
  it('with a zero timeout, checks exactly once without waiting', async () => {
    const fetchOwned = vi.fn().mockResolvedValue(new Set([1, 2]));
    const waitFn = vi.fn(async () => {});

    await expect(waitForRedeemConfirmation(before, fetchOwned, noSuccessScreen, waitFn, 0)).resolves.toBe(false);
    expect(fetchOwned).toHaveBeenCalledTimes(1);
    expect(waitFn).not.toHaveBeenCalled();
  });

  // No baseline means a library diff can't tell new from already-owned — only
  // the success screen can confirm.
  it('without a "before" snapshot, never consults the library', async () => {
    const fetchOwned = vi.fn().mockResolvedValue(new Set([1, 2, 3]));

    await expect(waitForRedeemConfirmation(null, fetchOwned, noSuccessScreen, vi.fn(async () => {}), 3000, 1000)).resolves.toBe(false);
    expect(fetchOwned).not.toHaveBeenCalled();
  });
});
