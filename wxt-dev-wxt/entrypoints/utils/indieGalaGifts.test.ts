import { describe, it, expect } from 'vitest';
import {
  findPasscodeInput,
  findRevealButton,
  isSteamKeyPrize,
  parseGameplayGifts,
  readGiftKeys,
} from './indieGalaGifts';

// Trimmed from the library's G. Giveaway tab (confirmed live, Nov 2026).
const giftItem = (id: string, password: string) => `
  <div class="profile-private-page-library-gift-item overflow-auto">
    <figcaption class="overflow-auto"><div class="profile-private-page-library-gift-title"><div class="overflow-auto">
      <div class="left profile-private-page-library-gift-title-item"><i class="fa fa-clock-o"></i><span>Nov. 6, 2026, 8:26 a.m.</span></div>
      <div class="left profile-private-page-library-gift-title-item"><a href="/gift-bundle/${id}"><i class="fa fa-link"></i> Gift link</a></div>
      <div class="left profile-private-page-library-gift-title-item"><i class="fa fa-unlock"></i><span>${password}</span></div>
    </div></div></figcaption>
  </div>`;
const library = (items: string) => `
  <div class="profile-private-page-library-tab-cont profile-private-page-library-tab-gameplay display-none" ref="gameplay">
    <div class="profile-private-page-library-gifts-list">${items}</div>
  </div>`;

describe('parseGameplayGifts', () => {
  it('reads each gift link with its password', () => {
    const gifts = parseGameplayGifts(library(giftItem('abc123', 'G8PYYQ') + giftItem('def456', 'Q1W2E3')));

    expect(gifts).toEqual([
      { url: 'https://www.indiegala.com/gift-bundle/abc123', password: 'G8PYYQ' },
      { url: 'https://www.indiegala.com/gift-bundle/def456', password: 'Q1W2E3' },
    ]);
  });

  it('is an empty list when the tab has no gift', () => {
    expect(parseGameplayGifts(library(''))).toEqual([]);
  });

  // A signed-out visit lands on the login page instead: no tab at all.
  it('is null when the page has no G. Giveaway tab', () => {
    expect(parseGameplayGifts('<form action="/login"></form>')).toBeNull();
  });
});

// Trimmed from a gift page (confirmed live, Nov 2026): a key already shown.
const SHOWN_KEY = `
  <div class="profile-private-page-library-key-cont overflow-auto">
    <div class="left profile-private-page-library-title"><div class="profile-private-page-library-title-row-full" title="Secret Game">Secret Game</div></div>
    <div class="right profile-private-page-library-key profile-private-page-library-key-redeemed"><div class="overflow-auto relative">
      <div class="left"><input class="profile-private-page-library-key-serial" readonly type="text" value="AAAAA-BBBBB-CCCCC"></div>
      <div class="right profile-private-page-library-key-icon bg-gradient-grey"><i class="fa fa-steam"></i></div>
    </div></div>
  </div>`;
// Not yet shown: IndieGala's own button fetches it (getSerialKey in its
// profile_private.js), with the gift's password when it asks for one.
const HIDDEN_KEY = `
  <div class="profile-private-page-library-key-cont overflow-auto">
    <div class="left profile-private-page-library-title"><div class="profile-private-page-library-title-row-full" title="Other Game">Other Game</div></div>
    <div class="right profile-private-page-library-key"><div class="overflow-auto relative">
      <input class="profile-private-page-library-passcode" type="text">
      <a href="#" onclick="getSerialKey('code', 123, '.ctx', true, this, event)">Get key</a>
      <div class="right profile-private-page-library-key-icon"><i class="fa fa-steam"></i></div>
    </div></div>
  </div>`;
const docFrom = (html: string) => new DOMParser().parseFromString(html, 'text/html');

describe('readGiftKeys', () => {
  it('reads a shown Steam key with its game', () => {
    expect(readGiftKeys(docFrom(SHOWN_KEY))).toEqual([{ title: 'Secret Game', key: 'AAAAA-BBBBB-CCCCC', isSteam: true }]);
  });

  it('reports a key not shown yet as missing', () => {
    expect(readGiftKeys(docFrom(HIDDEN_KEY))).toEqual([{ title: 'Other Game', key: null, isSteam: true }]);
  });

  it('tells a key for another store apart', () => {
    const html = SHOWN_KEY.replace('fa-steam', 'fa-key');
    expect(readGiftKeys(docFrom(html))[0].isSteam).toBe(false);
  });
});

describe('the hidden key controls', () => {
  it('finds IndieGala\'s own reveal button and the password field', () => {
    const container = docFrom(HIDDEN_KEY).querySelector<HTMLElement>('.profile-private-page-library-key-cont')!;

    expect(findRevealButton(container)?.textContent).toBe('Get key');
    expect(findPasscodeInput(container)).not.toBeNull();
  });

  it('finds no reveal button once the key is shown', () => {
    const container = docFrom(SHOWN_KEY).querySelector<HTMLElement>('.profile-private-page-library-key-cont')!;
    expect(findRevealButton(container)).toBeNull();
  });
});

describe('isSteamKeyPrize', () => {
  // The wheel's own label for its top prize (confirmed live, Nov 2026).
  it('recognises the wheel\'s Steam key prize', () => {
    expect(isSteamKeyPrize('🤩 ✨ Steam key')).toBe(true);
    expect(isSteamKeyPrize('💿 10 GalaSilver')).toBe(false);
  });
});
