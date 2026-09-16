import { describe, it, expect, vi } from 'vitest';
import { claimOfferCard, hasPrimeMembership, isInternalOfferCard, parseInternalOffers, parseOfferCard, PRIME_GAMING_HOME_URL } from './primeGamingGiveaway';
import { Platforms } from '@/entrypoints/enums/platforms.ts';

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

describe('parseOfferCard', () => {
  it('extracts title, link, and image from an internal card', () => {
    const game = parseOfferCard(elFrom(INTERNAL_CARD));
    expect(game).toEqual({
      title: 'Some Game',
      platform: Platforms.PrimeGaming,
      link: PRIME_GAMING_HOME_URL,
      img: 'https://images/game.png',
    });
  });

  it('returns null when the card has no title', () => {
    const card = elFrom(`<div class="item-card__action"><a href="/x"></a></div>`);
    expect(parseOfferCard(card)).toBeNull();
  });

  it('falls back to the default icon when no image is present', () => {
    const card = elFrom(`<div class="item-card__action"><a href="/x"></a><div class="item-card-details__body__primary">T</div></div>`);
    expect(parseOfferCard(card)?.img).toBe('/icon/128.png');
  });
});

describe('parseInternalOffers', () => {
  it('returns only internal cards, skipping external ones', () => {
    const list = elFrom(`<div>${INTERNAL_CARD}${EXTERNAL_CARD}</div>`);
    const games = parseInternalOffers(list);
    expect(games).toHaveLength(1);
    expect(games[0].title).toBe('Some Game');
  });

  it('returns an empty array when there are no offer cards', () => {
    expect(parseInternalOffers(elFrom('<div></div>'))).toEqual([]);
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

describe('claimOfferCard', () => {
  it('clicks the button and returns "claimed" when the collected marker is already present', async () => {
    const card = elFrom(CARD_WITH_CLAIM_BUTTON);
    const collected = card.ownerDocument.createElement('p');
    collected.textContent = 'Collected';
    card.appendChild(collected);

    const clickFn = vi.fn();
    const waitFn = vi.fn(async () => {});

    const outcome = await claimOfferCard(card, clickFn, waitFn);

    expect(outcome).toBe('claimed');
    expect(clickFn).toHaveBeenCalledTimes(1);
    expect(clickFn).toHaveBeenCalledWith(card.querySelector('button'));
    // The marker was readable on the very first check, so no poll was needed.
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
