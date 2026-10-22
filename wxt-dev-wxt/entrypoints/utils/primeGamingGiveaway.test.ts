import { describe, it, expect, vi } from 'vitest';
import {
  claimExternalOfferPage,
  claimOfferCard,
  detectExternalPlatform,
  extractRedeemCode,
  excludeCollectedOffers,
  hasPrimeMembership,
  isCollectedOfferCard,
  isInternalOfferCard,
  isOfferDetailsPage,
  parseExternalOfferCard,
  parseExternalOffers,
  parseInternalOffers,
  parseOfferCard,
  PRIME_GAMING_HOME_URL,
} from './primeGamingGiveaway';
import { Platforms } from '@/entrypoints/enums/platforms.ts';
import { FreeGame } from '@/entrypoints/types/freeGame.ts';

function elFrom(html: string): Element {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  return doc.body.firstElementChild as Element;
}

function docFrom(html: string): Document {
  return new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
}

const INTERNAL_CARD = `
<div class="item-card__action">
  <a href="/some-game-fgwp/dp/amzn1.pg.item.abc?ingress=amzn">
    <img class="tw-image" src="https://images/game.png"/>
  </a>
  <div class="item-card-details__body__primary">Some Game</div>
  <button data-a-target="FGWPOffer" class="tw-button">Claim</button>
</div>`;

const EXTERNAL_CARD = `
<div class="item-card__action">
  <a data-a-target="FGWPOffer" href="/other-game-fgwp/dp/amzn1.pg.item.def?ingress=amzn">
    <img class="tw-image" src="https://images/other.png"/>
  </a>
  <div class="item-card-details__body__primary">Other Game</div>
</div>`;

describe('isInternalOfferCard', () => {
  it('is true when the card has a claim <button> (in-store claim)', () => {
    expect(isInternalOfferCard(elFrom(INTERNAL_CARD))).toBe(true);
  });

  it('is false when the card only has an <a> claim link (external store)', () => {
    expect(isInternalOfferCard(elFrom(EXTERNAL_CARD))).toBe(false);
  });
});

const BASE_URL = 'https://luna.amazon.com/home';

describe('parseOfferCard', () => {
  it('extracts title, link, and image from an internal card', () => {
    const game = parseOfferCard(elFrom(INTERNAL_CARD), BASE_URL);
    expect(game).toEqual({
      title: 'Some Game',
      platform: Platforms.PrimeGaming,
      link: PRIME_GAMING_HOME_URL,
      img: 'https://images/game.png',
    });
  });

  it('returns null when the card has no title', () => {
    const card = elFrom(`<div class="item-card__action"><a href="/x"></a></div>`);
    expect(parseOfferCard(card, BASE_URL)).toBeNull();
  });

  it('falls back to the default icon when no image is present', () => {
    const card = elFrom(`<div class="item-card__action"><a href="/x"></a><div class="item-card-details__body__primary">T</div></div>`);
    expect(parseOfferCard(card, BASE_URL)?.img).toBe('/icon/128.png');
  });

  // Amazon's card grid lazy-loads images, leaving `src` blank/placeholder
  // until the card scrolls into view — the real URL lives on a data-*
  // attribute instead, the same pattern Steam's scraper already handles.
  it('falls back to a data-src lazy-load attribute when src is empty', () => {
    const card = elFrom(`<div class="item-card__action"><a href="/x"></a><div class="item-card-details__body__primary">T</div><img class="tw-image" data-src="https://images/lazy.png"/></div>`);
    expect(parseOfferCard(card, BASE_URL)?.img).toBe('https://images/lazy.png');
  });

  it('falls back to a data-lazy attribute when neither src nor data-src is present', () => {
    const card = elFrom(`<div class="item-card__action"><a href="/x"></a><div class="item-card-details__body__primary">T</div><img class="tw-image" data-lazy="https://images/lazy2.png"/></div>`);
    expect(parseOfferCard(card, BASE_URL)?.img).toBe('https://images/lazy2.png');
  });

  // Prime's own `link` field was already resolved against baseUrl; the image
  // field never got the same treatment, so a relative/protocol-relative src
  // rendered incorrectly inside the extension's popup origin.
  it('resolves a relative image URL against the base URL', () => {
    const card = elFrom(`<div class="item-card__action"><a href="/x"></a><div class="item-card-details__body__primary">T</div><img class="tw-image" src="/images/relative.png"/></div>`);
    expect(parseOfferCard(card, BASE_URL)?.img).toBe('https://luna.amazon.com/images/relative.png');
  });
});

describe('parseInternalOffers', () => {
  it('returns only internal cards, skipping external ones', () => {
    const list = elFrom(`<div>${INTERNAL_CARD}${EXTERNAL_CARD}</div>`);
    const games = parseInternalOffers(list, BASE_URL);
    expect(games).toHaveLength(1);
    expect(games[0].title).toBe('Some Game');
  });

  it('returns an empty array when there are no offer cards', () => {
    expect(parseInternalOffers(elFrom('<div></div>'), BASE_URL)).toEqual([]);
  });
});

describe('hasPrimeMembership', () => {
  it('is true when there is no "Try Prime" button', () => {
    const doc = docFrom('<button>Sign out</button>');
    expect(hasPrimeMembership(doc)).toBe(true);
  });

  it('is false when a "Try Prime" button is present', () => {
    const doc = docFrom('<button>Try Prime</button>');
    expect(hasPrimeMembership(doc)).toBe(false);
  });
});

const CARD_WITH_CLAIM_BUTTON = `
<div class="item-card__action">
  <div class="item-card-details__body__primary">Some Game</div>
  <button data-a-target="FGWPOffer" class="tw-button">Claim</button>
</div>`;

// Confirmed live: clicking an external offer navigates to
// https://luna.amazon.com/claims/{slug}/dp/{itemId}?ingress=amzn — a details
// page distinct from the offer-list page.
// Confirmed live: cards carry no icon/alt/title/aria-label naming the
// platform — only the claim href's slug suffix does.
const EPIC_EXTERNAL_CARD = `
<div class="item-card__action">
  <a data-a-target="FGWPOffer" href="/claims/space-grunts-epic/dp/amzn1.pg.item.dbfe54c6?ingress=amzn">
    <img class="tw-image" src="https://images/space-grunts.png"/>
  </a>
  <div class="item-card-details__body__primary">Space Grunts</div>
</div>`;

const GOG_EXTERNAL_CARD = `
<div class="item-card__action">
  <a data-a-target="FGWPOffer" href="/claims/weakless-gog/dp/amzn1.pg.item.aaa?ingress=amzn">
    <img class="tw-image" src="https://images/weakless.png"/>
  </a>
  <div class="item-card-details__body__primary">Weakless</div>
</div>`;

describe('detectExternalPlatform', () => {
  it('detects Epic from the claim href\'s slug suffix', () => {
    expect(detectExternalPlatform('/claims/space-grunts-epic/dp/amzn1.pg.item.dbfe54c6?ingress=amzn')).toBe('Epic');
  });

  it('detects GOG from the claim href\'s slug suffix', () => {
    expect(detectExternalPlatform('/claims/weakless-gog/dp/amzn1.pg.item.aaa?ingress=amzn')).toBe('GOG');
  });

  it('detects Windows from the claim href\'s slug suffix', () => {
    expect(detectExternalPlatform('/claims/doom-eternal-microsoft/dp/amzn1.pg.item.bbb?ingress=amzn')).toBe('Windows');
  });

  it('works against a full absolute URL, not just a path', () => {
    expect(detectExternalPlatform('https://luna.amazon.com/claims/drop-duchy-epic/dp/amzn1.pg.item.ccc?ingress=amzn')).toBe('Epic');
  });

  // "-aga" is Amazon's own native-launcher app — a real platform seen live,
  // just not one of the three this extension supports.
  it('returns null for an unsupported platform suffix (Amazon Games App)', () => {
    expect(detectExternalPlatform('/claims/havendock-aga/dp/amzn1.pg.item.ddd?ingress=amzn')).toBeNull();
  });

  it('returns null when the href has no /claims/ segment at all', () => {
    expect(detectExternalPlatform('/home')).toBeNull();
  });
});

describe('parseExternalOfferCard', () => {
  it('resolves the relative claims-page href against the given base URL', () => {
    const game = parseExternalOfferCard(elFrom(EPIC_EXTERNAL_CARD), 'https://luna.amazon.com/home');
    expect(game).toEqual({
      title: 'Space Grunts',
      platform: Platforms.PrimeGaming,
      link: 'https://luna.amazon.com/claims/space-grunts-epic/dp/amzn1.pg.item.dbfe54c6?ingress=amzn',
      img: 'https://images/space-grunts.png',
    });
  });

  it('returns null when the card has no title', () => {
    const card = elFrom('<div class="item-card__action"><a href="/x"></a></div>');
    expect(parseExternalOfferCard(card, 'https://luna.amazon.com/home')).toBeNull();
  });

  it('resolves a relative image URL against the base URL', () => {
    const card = elFrom(`<div class="item-card__action"><a href="/x"></a><div class="item-card-details__body__primary">T</div><img class="tw-image" src="/images/relative.png"/></div>`);
    expect(parseExternalOfferCard(card, 'https://luna.amazon.com/home')?.img).toBe('https://luna.amazon.com/images/relative.png');
  });
});

describe('parseExternalOffers', () => {
  const LIST_HTML = `<div>${INTERNAL_CARD}${EPIC_EXTERNAL_CARD}${GOG_EXTERNAL_CARD}</div>`;

  it('returns only external cards matching an allowed platform', () => {
    const games = parseExternalOffers(
      elFrom(LIST_HTML),
      new Set(['Epic']),
      'https://luna.amazon.com/home'
    );
    expect(games.map((g) => g.title)).toEqual(['Space Grunts']);
  });

  it('returns cards for every allowed platform', () => {
    const games = parseExternalOffers(
      elFrom(LIST_HTML),
      new Set(['Epic', 'GOG']),
      'https://luna.amazon.com/home'
    );
    expect(games.map((g) => g.title).sort()).toEqual(['Space Grunts', 'Weakless']);
  });

  it('returns nothing when no platform is allowed (opt-in default)', () => {
    expect(parseExternalOffers(elFrom(LIST_HTML), new Set(), 'https://luna.amazon.com/home')).toEqual([]);
  });

  it('never includes internal offers, even if somehow allowed', () => {
    const games = parseExternalOffers(
      elFrom(LIST_HTML),
      new Set(['Epic', 'GOG', 'Windows']),
      'https://luna.amazon.com/home'
    );
    expect(games.some((g) => g.title === 'Some Game')).toBe(false);
  });
});

describe('isOfferDetailsPage', () => {
  it('is true for a confirmed live claims-details path', () => {
    expect(isOfferDetailsPage('/claims/space-grunts-chrono-shard-epic/dp/amzn1.pg.item.dbfe54c6-6298-46ec-808d-49d3915b9734')).toBe(true);
  });

  it('is false for the offer-list home path', () => {
    expect(isOfferDetailsPage('/claims/home')).toBe(false);
  });
});

describe('claimExternalOfferPage', () => {
  const DETAILS_URL = 'https://luna.amazon.com/claims/space-grunts-epic/dp/amzn1.pg.item.abc?ingress=amzn';

  it('returns "claimed" once the "Get game" button disappears (already linked)', async () => {
    let buttonGone = false;
    const button = document.createElement('button');
    const clickFn = vi.fn();
    let calls = 0;
    const waitFn = vi.fn(async () => {
      calls++;
      if (calls === 1) buttonGone = true;
    });

    const outcome = await claimExternalOfferPage(
      () => (buttonGone ? null : button),
      clickFn,
      waitFn,
      () => DETAILS_URL,
    );

    expect(outcome).toBe('claimed');
    expect(clickFn).toHaveBeenCalledWith(button);
  });

  // Confirmed live (Oct 2026): a successful claim now routes to the offer's
  // own ".../details" sub-page ("Success, ...") instead of updating in place.
  it('returns "claimed" when the URL changes to the offer\'s /details success page', async () => {
    let url = DETAILS_URL;
    const button = document.createElement('button');
    const waitFn = vi.fn(async () => {
      url = 'https://luna.amazon.com/claims/space-grunts-epic/dp/amzn1.pg.item.abc/details?ingress=amzn';
    });

    const outcome = await claimExternalOfferPage(() => button, vi.fn(), waitFn, () => url);

    expect(outcome).toBe('claimed');
  });

  it('returns "link-required" when the URL changes away from the details page (not linked)', async () => {
    let url = DETAILS_URL;
    const button = document.createElement('button');
    const waitFn = vi.fn(async () => {
      url = 'https://www.amazon.com/ap/oa?client_id=epic-games';
    });

    const outcome = await claimExternalOfferPage(() => button, vi.fn(), waitFn, () => url);

    expect(outcome).toBe('link-required');
  });

  // Confirmed live: the header's login signal renders ~300ms before the
  // "Get game" button, so the button is routinely absent on the first look.
  it('waits for a "Get game" button that renders after the first lookup', async () => {
    const button = document.createElement('button');
    const clickFn = vi.fn();
    let lookups = 0;
    let clicked = false;
    clickFn.mockImplementation(() => { clicked = true; });

    const outcome = await claimExternalOfferPage(
      () => {
        lookups++;
        if (clicked) return null;
        return lookups >= 3 ? button : null;
      },
      clickFn,
      vi.fn(async () => {}),
      () => DETAILS_URL,
    );

    expect(clickFn).toHaveBeenCalledWith(button);
    expect(outcome).toBe('claimed');
  });

  // Confirmed live: an already-collected offer still renders "Get game", but
  // disabled — clicking it does nothing, so it must not be treated as a claim
  // attempt that then times out.
  it('returns "already-claimed" without clicking when the "Get game" button is disabled', async () => {
    const button = document.createElement('button');
    button.disabled = true;
    const clickFn = vi.fn();

    const outcome = await claimExternalOfferPage(() => button, clickFn, vi.fn(async () => {}), () => DETAILS_URL);

    expect(outcome).toBe('already-claimed');
    expect(clickFn).not.toHaveBeenCalled();
  });

  it('returns "failed" without clicking when no "Get game" button is found', async () => {
    const clickFn = vi.fn();
    const outcome = await claimExternalOfferPage(() => null, clickFn, vi.fn(async () => {}), () => DETAILS_URL);

    expect(outcome).toBe('failed');
    expect(clickFn).not.toHaveBeenCalled();
  });

  it('returns "failed" when neither signal appears before the timeout', async () => {
    const button = document.createElement('button');
    const outcome = await claimExternalOfferPage(
      () => button,
      vi.fn(),
      vi.fn(async () => {}),
      () => DETAILS_URL,
      20,
      5,
    );

    expect(outcome).toBe('failed');
  });
});

// Confirmed live: a collected card (internal or external) carries a
// <p>Collected</p> marker next to its title.
const COLLECTED_EXTERNAL_CARD = `
<div class="item-card__action">
  <a data-a-target="FGWPOffer" href="/claims/rims-racing-epic/dp/amzn1.pg.item.2cf?ingress=amzn">
    <img class="tw-image" src="https://images/rims.png"/>
  </a>
  <div class="item-card-details__body__primary">RiMS Racing</div>
  <p>Collected</p>
</div>`;

describe('isCollectedOfferCard', () => {
  it('is true when the card shows the "Collected" marker', () => {
    expect(isCollectedOfferCard(elFrom(COLLECTED_EXTERNAL_CARD))).toBe(true);
  });

  it('is false for an unclaimed card', () => {
    expect(isCollectedOfferCard(elFrom(EXTERNAL_CARD))).toBe(false);
  });
});

// Regression (found live): every manual "Claim now" reopened all 7
// already-collected external offers, since only unseen titles were filtered.
describe('excludeCollectedOffers', () => {
  const offer = (title: string): FreeGame => ({
    title,
    platform: Platforms.PrimeGaming,
    link: `https://luna.amazon.com/claims/${title}/dp/x`,
    img: '/icon/128.png',
  });

  it('drops games whose card on the offer list is marked collected', () => {
    const offerList = elFrom(`<div>${EXTERNAL_CARD}${COLLECTED_EXTERNAL_CARD}</div>`);

    expect(excludeCollectedOffers([offer('Other Game'), offer('RiMS Racing')], offerList))
      .toEqual([offer('Other Game')]);
  });

  // Two cards can share a title (e.g. re-listed offers); one being collected
  // must not drop the other, unclaimed one.
  it('keeps a title that also has an uncollected card', () => {
    const uncollectedTwin = EXTERNAL_CARD.replace('Other Game', 'RiMS Racing');
    const offerList = elFrom(`<div>${COLLECTED_EXTERNAL_CARD}${uncollectedTwin}</div>`);

    expect(excludeCollectedOffers([offer('RiMS Racing')], offerList)).toEqual([offer('RiMS Racing')]);
  });

  it('keeps everything when nothing is collected', () => {
    const offerList = elFrom(`<div>${INTERNAL_CARD}${EXTERNAL_CARD}</div>`);

    expect(excludeCollectedOffers([offer('Some Game'), offer('Other Game')], offerList))
      .toEqual([offer('Some Game'), offer('Other Game')]);
  });
});

describe('extractRedeemCode', () => {
  // Confirmed live: a GOG redeem code is one contiguous uppercase alphanumeric
  // string, no separators — e.g. "YRXG7D62AF07ADCE5B" (19 chars).
  it('extracts a contiguous uppercase alphanumeric redeem code from the page text', () => {
    const doc = docFrom('<div class="code-panel"><p>Your code:</p><p>YRXG7D62AF07ADCE5B</p></div>');
    expect(extractRedeemCode(doc)).toBe('YRXG7D62AF07ADCE5B');
  });

  // Confirmed live: the post-claim /details page shows the code only as a
  // readonly input's value (not text content), alongside a hidden csrf input.
  it('extracts the code from a readonly input value, ignoring hidden inputs', () => {
    const doc = docFrom(
      '<input type="hidden" name="csrf-key" value="ABCDEF1234567890XY">' +
      '<h1>Success, you received a code to redeem DOOM.</h1>' +
      '<input type="text" readonly value="TKT86D6B64FBD15B97">'
    );
    expect(extractRedeemCode(doc)).toBe('TKT86D6B64FBD15B97');
  });

  it('returns null when no code-like pattern is present', () => {
    const doc = docFrom('<div>Thanks for claiming Some Game!</div>');
    expect(extractRedeemCode(doc)).toBeNull();
  });

  // The Luna item id (amzn1.pg.item.<lowercase-hex-uuid>) appears on every
  // details page — the pattern must not mistake it for the redeem code,
  // which GOG issues in uppercase.
  it('does not match a lowercase UUID-style item id', () => {
    const doc = docFrom('<div>amzn1.pg.item.dbfe54c6-6298-46ec-808d-49d3915b9734</div>');
    expect(extractRedeemCode(doc)).toBeNull();
  });

  it('does not match a plain all-caps word (needs both a letter and a digit)', () => {
    const doc = docFrom('<div>CONGRATULATIONS</div>');
    expect(extractRedeemCode(doc)).toBeNull();
  });

  it('does not match a pure number (needs both a letter and a digit)', () => {
    const doc = docFrom('<div>1234567890123456</div>');
    expect(extractRedeemCode(doc)).toBeNull();
  });

  it('returns the first match when multiple code-like strings are present', () => {
    const doc = docFrom('<div>YRXG7D62AF07ADCE5B first, then AB12CD34EF56GH78IJ second</div>');
    expect(extractRedeemCode(doc)).toBe('YRXG7D62AF07ADCE5B');
  });

  // Confirmed live against a real DOOM Eternal (Windows) claim: Microsoft
  // codes are hyphen-grouped, unlike GOG's contiguous ones, and a group is
  // allowed to be all-letters (no digit) — "WXJKR" here has none.
  it('extracts a hyphen-grouped Windows/Xbox redeem code', () => {
    const doc = docFrom('<p>Your code: "DF3FX-WWG3M-WXJKR-94Q6K-H2RMZ"</p>');
    expect(extractRedeemCode(doc)).toBe('DF3FX-WWG3M-WXJKR-94Q6K-H2RMZ');
  });

  it('does not match a lowercase-hex, differently-grouped item id as a Windows code', () => {
    const doc = docFrom('<div>amzn1.pg.item.1c490f2e-c698-4077-94a6-6a69c98945e2</div>');
    expect(extractRedeemCode(doc)).toBeNull();
  });

  // Confirmed live: the details page's "Copy code" button text runs directly
  // into the code with no whitespace in flattened textContent
  // ("...H2RMZCopy code"). A trailing \b can't see a boundary between two
  // word characters ("Z" and "C"), which previously made this a false
  // negative — regression guard for that.
  it('extracts a Windows code even when immediately followed by more letters with no separator', () => {
    const doc = docFrom('<p>Your code: DF3FX-WWG3M-WXJKR-94Q6K-H2RMZ</p><button>Copy code</button>');
    expect(extractRedeemCode(doc)).toBe('DF3FX-WWG3M-WXJKR-94Q6K-H2RMZ');
  });
});

describe('claimOfferCard', () => {
  it('returns "already-claimed" without clicking when the collected marker is already present', async () => {
    const card = elFrom(CARD_WITH_CLAIM_BUTTON);
    const collected = card.ownerDocument.createElement('p');
    collected.textContent = 'Collected';
    card.appendChild(collected);

    const clickFn = vi.fn();
    const waitFn = vi.fn(async () => {});

    const outcome = await claimOfferCard(card, clickFn, waitFn);

    expect(outcome).toBe('already-claimed');
    // A card claimed on a previous run must be left alone, not re-clicked and
    // miscounted as freshly claimed every run.
    expect(clickFn).not.toHaveBeenCalled();
    expect(waitFn).not.toHaveBeenCalled();
  });

  it('returns "claimed" once the collected marker appears after a few polls', async () => {
    const card = elFrom(CARD_WITH_CLAIM_BUTTON);
    const clickFn = vi.fn();
    let calls = 0;
    const waitFn = vi.fn(async () => {
      calls++;
      if (calls === 2) {
        const collected = card.ownerDocument.createElement('p');
        collected.textContent = 'Collected';
        card.appendChild(collected);
      }
    });

    const outcome = await claimOfferCard(card, clickFn, waitFn, 5_000, 250);

    expect(outcome).toBe('claimed');
    expect(waitFn).toHaveBeenCalledTimes(2);
  });

  it('returns "failed" when the collected marker never appears before the timeout', async () => {
    const card = elFrom(CARD_WITH_CLAIM_BUTTON);
    const clickFn = vi.fn();
    const waitFn = vi.fn(async () => {});

    // A tiny timeout keeps this test fast; waitFn never mutates the DOM so the
    // poll loop must exhaust the deadline and report failure.
    const outcome = await claimOfferCard(card, clickFn, waitFn, 20, 5);

    expect(outcome).toBe('failed');
    expect(clickFn).toHaveBeenCalledTimes(1);
  });

  it('returns "failed" without clicking when the card has no claim button', async () => {
    const card = elFrom('<div class="item-card__action"><p>No button here</p></div>');
    const clickFn = vi.fn();
    const waitFn = vi.fn(async () => {});

    const outcome = await claimOfferCard(card, clickFn, waitFn);

    expect(outcome).toBe('failed');
    expect(clickFn).not.toHaveBeenCalled();
    expect(waitFn).not.toHaveBeenCalled();
  });
});
