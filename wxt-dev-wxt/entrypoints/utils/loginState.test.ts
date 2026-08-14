import { describe, it, expect, beforeEach } from 'vitest';
import { fakeBrowser } from 'wxt/testing';
import { Platforms } from '@/entrypoints/enums/platforms';
import { getStorageItem } from '@/entrypoints/hooks/useStorage';
import {
  LOGIN_STATE_KEYS,
  readEpicLoginState,
  readSteamLoginState,
  readLoginState,
  detectLoginState,
  recordLoginState,
} from './loginState';

function docFrom(html: string): Document {
  const parsed = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  return parsed;
}

describe('readEpicLoginState', () => {
  it('is true when the nav reports a signed-in session', () => {
    const doc = docFrom('<egs-navigation isloggedin="true"></egs-navigation>');
    expect(readEpicLoginState(doc)).toBe(true);
  });

  it('is false when the nav reports a signed-out session', () => {
    const doc = docFrom('<egs-navigation isloggedin="false"></egs-navigation>');
    expect(readEpicLoginState(doc)).toBe(false);
  });

  it('is null while the nav exists but has not hydrated the attribute yet', () => {
    const doc = docFrom('<egs-navigation></egs-navigation>');
    expect(readEpicLoginState(doc)).toBeNull();
  });

  it('is null when the nav is absent entirely', () => {
    const doc = docFrom('<div>no nav here</div>');
    expect(readEpicLoginState(doc)).toBeNull();
  });
});

describe('readSteamLoginState', () => {
  it('is true when the account pulldown is present', () => {
    const doc = docFrom('<div id="global_actions"><div id="account_pulldown">me</div></div>');
    expect(readSteamLoginState(doc)).toBe(true);
  });

  it('is false when the header rendered without an account pulldown', () => {
    const doc = docFrom('<div id="global_actions"><a href="/login">Login</a></div>');
    expect(readSteamLoginState(doc)).toBe(false);
  });

  it('is null when the header itself has not rendered', () => {
    const doc = docFrom('<div>no header here</div>');
    expect(readSteamLoginState(doc)).toBeNull();
  });
});

describe('readLoginState', () => {
  it('dispatches to the Epic reader', () => {
    const doc = docFrom('<egs-navigation isloggedin="true"></egs-navigation>');
    expect(readLoginState(Platforms.Epic, doc)).toBe(true);
  });

  it('dispatches to the Steam reader', () => {
    const doc = docFrom('<div id="global_actions"><div id="account_pulldown"></div></div>');
    expect(readLoginState(Platforms.Steam, doc)).toBe(true);
  });

  it('does not confuse one platform signal for the other', () => {
    const doc = docFrom('<div id="global_actions"><div id="account_pulldown"></div></div>');
    expect(readLoginState(Platforms.Epic, doc)).toBeNull();
  });
});

describe('detectLoginState', () => {
  it('returns immediately once the signal is readable', async () => {
    const doc = docFrom('<egs-navigation isloggedin="false"></egs-navigation>');
    expect(await detectLoginState(Platforms.Epic, doc, 1_000)).toBe(false);
  });

  it('resolves to null after the timeout when no signal ever appears', async () => {
    const doc = docFrom('<div>nothing</div>');
    expect(await detectLoginState(Platforms.Epic, doc, 10)).toBeNull();
  });

  it('picks up a signal that appears after the first poll', async () => {
    const doc = docFrom('<div>nothing</div>');
    setTimeout(() => {
      const nav = doc.createElement('egs-navigation');
      nav.setAttribute('isloggedin', 'true');
      doc.body.appendChild(nav);
    }, 20);
    expect(await detectLoginState(Platforms.Epic, doc, 2_000)).toBe(true);
  });
});

describe('recordLoginState', () => {
  beforeEach(() => {
    fakeBrowser.reset();
  });

  it('persists a positive result under the platform key', async () => {
    await recordLoginState(Platforms.Steam, true);
    expect(await getStorageItem(LOGIN_STATE_KEYS[Platforms.Steam])).toBe(true);
  });

  it('persists a negative result under the platform key', async () => {
    await recordLoginState(Platforms.Epic, false);
    expect(await getStorageItem(LOGIN_STATE_KEYS[Platforms.Epic])).toBe(false);
  });

  it('leaves the last known state untouched when the read was inconclusive', async () => {
    await recordLoginState(Platforms.Epic, true);
    await recordLoginState(Platforms.Epic, null);
    expect(await getStorageItem(LOGIN_STATE_KEYS[Platforms.Epic])).toBe(true);
  });

  it('writes nothing at all for an inconclusive read on a fresh install', async () => {
    await recordLoginState(Platforms.Steam, null);
    expect(await getStorageItem(LOGIN_STATE_KEYS[Platforms.Steam])).toBeNull();
  });

  it('uses distinct keys per platform', () => {
    const keys = Object.values(Platforms).map((platform) => LOGIN_STATE_KEYS[platform]);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('has a key for every platform, including GOG', () => {
    for (const platform of Object.values(Platforms)) {
      expect(LOGIN_STATE_KEYS[platform]).toBeTruthy();
    }
  });

  // GOG's session is proven by the giveaway API answering 401 or not, so its
  // content script records the state directly. Reading the DOM must stay
  // inconclusive rather than falling through to Steam's selectors.
  it('reports no DOM signal for GOG instead of applying another store\'s selectors', () => {
    const doc = new DOMParser().parseFromString(
      '<div id="global_actions"><div id="account_pulldown"></div></div>',
      'text/html'
    );
    expect(readLoginState(Platforms.GOG, doc)).toBeNull();
  });
});
