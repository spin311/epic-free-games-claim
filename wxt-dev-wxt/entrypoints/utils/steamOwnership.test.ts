import { describe, it, expect } from 'vitest';
import { markSteamOwned, parseSteamOwnedApps, steamAppId } from './steamOwnership';
import { Platforms } from '@/entrypoints/enums/platforms';
import { FreeGame } from '@/entrypoints/types/freeGame';

const game = (link: string, title = 'Game'): FreeGame => ({ title, link, img: '', platform: Platforms.Steam });

describe('steamAppId', () => {
  it('reads the app id from a store link', () => {
    expect(steamAppId('https://store.steampowered.com/app/1234560/Some_Game/?snr=1_7')).toBe(1234560);
  });

  it('is null for anything that is not an app page', () => {
    expect(steamAppId('https://store.steampowered.com/sub/55/')).toBeNull();
    expect(steamAppId('not a url')).toBeNull();
  });
});

describe('parseSteamOwnedApps', () => {
  // The shape of /dynamicstore/userdata/ (confirmed live, Nov 2026).
  it('reads the owned app ids', () => {
    const owned = parseSteamOwnedApps({ rgOwnedApps: [10, 20], rgOwnedPackages: [5], rgWishlist: [] });
    expect(owned).toEqual(new Set([10, 20]));
  });

  it('is null when the answer has no owned list, so nothing is marked from it', () => {
    expect(parseSteamOwnedApps({ error: 'nope' })).toBeNull();
    expect(parseSteamOwnedApps(null)).toBeNull();
    expect(parseSteamOwnedApps({ rgOwnedApps: ['10'] })).toBeNull();
  });
});

describe('markSteamOwned', () => {
  it('marks the games the account owns and leaves the rest', () => {
    const games = [game('https://store.steampowered.com/app/10/A/', 'A'), game('https://store.steampowered.com/app/30/B/', 'B')];

    const marked = markSteamOwned(games, new Set([10]));

    expect(marked.map((g) => [g.title, g.claimed])).toEqual([['A', true], ['B', undefined]]);
    expect(games[0].claimed).toBeUndefined();
  });

  it('marks nothing when ownership is unknown', () => {
    const games = [game('https://store.steampowered.com/app/10/A/')];
    expect(markSteamOwned(games, null)).toEqual(games);
  });
});
