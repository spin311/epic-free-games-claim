// @vitest-environment node
import { describe, it, expect, beforeEach } from 'vitest';
import { fakeBrowser } from 'wxt/testing';
import { getStorageItem, setStorageItem } from '@/entrypoints/hooks/useStorage';
import { PENDING_REDEMPTIONS_STORAGE_KEY, PendingRedemption } from './pendingRedemptions';
import {
  handleGiftKeys,
  KNOWN_GIFTS_KEY,
  LAST_STEAM_KEY_KEY,
  parseGiftKeys,
  parseSteamKeyReport,
  recordSteamKeyResult,
  recordUnreadGiftKey,
  rememberGifts,
  takeNewGifts,
} from './steamKeyFlow';

const gift = (id: string) => ({ url: `https://www.indiegala.com/gift-bundle/${id}`, password: 'PW' });

beforeEach(() => {
  fakeBrowser.reset();
});

describe('takeNewGifts', () => {
  it('returns only the gifts that appeared since they were remembered, once', async () => {
    await rememberGifts([gift('old')]);

    expect(await takeNewGifts([gift('old'), gift('new')])).toEqual([gift('new')]);
    expect(await takeNewGifts([gift('old'), gift('new')])).toEqual([]);
  });

  // Nothing to compare with: everything there may be years old (a 2021
  // giveaway's gift sits in the list), so none of it is taken as won now.
  it('takes nothing, and remembers everything, when nothing was remembered before', async () => {
    expect(await takeNewGifts([gift('old')])).toEqual([]);
    expect(await getStorageItem(KNOWN_GIFTS_KEY)).toEqual([gift('old').url]);
  });
});

describe('recordSteamKeyResult', () => {
  const result = (outcome: string) => ({
    key: 'AAAAA-BBBBB-CCCCC', title: 'Some Game', outcome, products: ['Some Game'], message: 'msg',
  });

  it('records an activation, counts it, and clears the key from the pending list', async () => {
    await setStorageItem('counter', 0); // as the popup leaves it
    await setStorageItem(PENDING_REDEMPTIONS_STORAGE_KEY, [
      { code: 'AAAAA-BBBBB-CCCCC', platform: 'Steam', title: 'Some Game', redeemUrl: 'x', addedAt: 'y' },
    ]);

    expect(await recordSteamKeyResult(result('activated') as never)).toBe('done');

    expect(await getStorageItem(LAST_STEAM_KEY_KEY)).toEqual(expect.objectContaining({ title: 'Some Game', outcome: 'activated' }));
    expect(await getStorageItem(PENDING_REDEMPTIONS_STORAGE_KEY)).toEqual([]);
    expect(await getStorageItem('counter')).toBe(1);
  });

  it('counts a game the account already owned as done, but not as claimed', async () => {
    await setStorageItem('counter', 0);
    expect(await recordSteamKeyResult(result('owned') as never)).toBe('done');
    expect(await getStorageItem('counter')).toBe(0);
  });

  it('keeps a key Steam didn\'t take in the pending list, with an activation link and the reason', async () => {
    expect(await recordSteamKeyResult(result('signed-out') as never)).toBe('pending');

    const pending = await getStorageItem<PendingRedemption[]>(PENDING_REDEMPTIONS_STORAGE_KEY);
    expect(pending).toEqual([expect.objectContaining({
      code: 'AAAAA-BBBBB-CCCCC',
      platform: 'Steam',
      title: 'Some Game',
      redeemUrl: 'https://store.steampowered.com/account/registerkey?key=AAAAA-BBBBB-CCCCC',
      reason: expect.stringMatching(/sign in to Steam/i),
    })]);
  });
});

describe('recordUnreadGiftKey', () => {
  it('keeps the page the key is on, so the win is never lost', async () => {
    await recordUnreadGiftKey('Steam key (Wheel of Fortune)', 'https://www.indiegala.com/library', 'Not found');

    const pending = await getStorageItem<PendingRedemption[]>(PENDING_REDEMPTIONS_STORAGE_KEY);
    expect(pending).toEqual([expect.objectContaining({
      code: '', platform: 'IndieGala', redeemUrl: 'https://www.indiegala.com/library', reason: 'Not found',
    })]);
  });
});

describe('handleGiftKeys', () => {
  const deps = (openTab: (url: string, action: string, data?: unknown) => Promise<void>) => ({
    openTab, fetchImpl: fetch, wait: async () => {},
  });

  // The Steam tab can die before it reports (closed, crashed, worker restart):
  // the key is kept before that tab even opens, and only a report clears it.
  it('keeps a Steam key in the pending list before taking it to Steam', async () => {
    let pendingWhenOpened: PendingRedemption[] | null = null;
    await handleGiftKeys('https://www.indiegala.com/gift-bundle/x',
        [{ title: 'Some Game', key: 'AAAAA-BBBBB-CCCCC', isSteam: true }],
        deps(async () => { pendingWhenOpened = await getStorageItem(PENDING_REDEMPTIONS_STORAGE_KEY); }));

    expect(pendingWhenOpened).toEqual([expect.objectContaining({ code: 'AAAAA-BBBBB-CCCCC', platform: 'Steam' })]);
  });

  it('clears that entry once Steam has the game', async () => {
    await handleGiftKeys('https://www.indiegala.com/gift-bundle/x',
        [{ title: 'Some Game', key: 'AAAAA-BBBBB-CCCCC', isSteam: true }], deps(async () => {}));

    await recordSteamKeyResult({ key: 'AAAAA-BBBBB-CCCCC', title: 'Some Game', outcome: 'activated', products: [], message: '' });

    expect(await getStorageItem(PENDING_REDEMPTIONS_STORAGE_KEY)).toEqual([]);
  });
});

describe('parseSteamKeyReport', () => {
  it('accepts a well-formed report', () => {
    const report = { key: 'K', title: 'T', outcome: 'used', products: ['P'], message: 'm' };
    expect(parseSteamKeyReport(report)).toEqual(report);
  });

  it('reads an unknown outcome as a failure and drops non-text products', () => {
    expect(parseSteamKeyReport({ key: 'K', title: 'T', outcome: 'weird', products: ['P', 3], message: 'm' }))
        .toEqual({ key: 'K', title: 'T', outcome: 'failed', products: ['P'], message: 'm' });
  });

  it('rejects a report without a key', () => {
    expect(parseSteamKeyReport({ title: 'T', outcome: 'activated' })).toBeNull();
    expect(parseSteamKeyReport(null)).toBeNull();
  });
});

describe('parseGiftKeys', () => {
  it('keeps well-formed keys and drops anything else', () => {
    expect(parseGiftKeys([{ title: 'A', key: 'K', isSteam: true }, null, { title: 3, key: 'K2', isSteam: true }, { title: 'B', key: null, isSteam: false }]))
        .toEqual([{ title: 'A', key: 'K', isSteam: true }, { title: 'B', key: null, isSteam: false }]);
    expect(parseGiftKeys('nope')).toEqual([]);
  });
});
