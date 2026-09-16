import { describe, it, expect } from 'vitest';
import { extractProductId, parseFreebiesList } from './indieGalaGiveaway';
import { Platforms } from '@/entrypoints/enums/platforms.ts';

const CARD_HTML = (slug: string, uuid: string, title: string) => `
<div class="col-3 products-col">
  <div class="products-col-inner box-shadow-1 relative">
    <a class="fit-click" href="https://freebies.indiegala.com/${slug}" title="Go to ${title} page"></a>
    <figure class="product-img">
      <img alt="${title} product image" class="display-none async-img-load" data-img-src="https://www.indiegalacdn.com/imgs/devs/freebies/products/${uuid}/prodmain/1759920499.png"/>
    </figure>
    <figcaption class="overflow-auto product-title-cont">
      <div class="left product-title">${title}</div>
      <div class="right product-get-btn">get</div>
    </figcaption>
  </div>
</div>`;

describe('extractProductId', () => {
  it('extracts the UUID from an indiegalacdn product image URL', () => {
    const uuid = 'a1db8f5b-f9c3-4004-84fc-ce90d0bb5872';
    const src = `https://www.indiegalacdn.com/imgs/devs/freebies/products/${uuid}/prodmain/1759920499.png`;
    expect(extractProductId(src)).toBe(uuid);
  });

  it('finds the UUID even inside a full HTML document', () => {
    const uuid = 'a1db8f5b-f9c3-4004-84fc-ce90d0bb5872';
    const html = `<meta content="https://www.indiegalacdn.com/imgs/devs/freebies/products/${uuid}/prodmain/1.png?v=1" property="og:image"/>`;
    expect(extractProductId(html)).toBe(uuid);
  });

  it('returns null when no product image URL is present', () => {
    expect(extractProductId('<div>nothing here</div>')).toBeNull();
  });
});

describe('parseFreebiesList', () => {
  it('parses a single freebie card into title, link, image, and product id', () => {
    const uuid = 'a1db8f5b-f9c3-4004-84fc-ce90d0bb5872';
    const html = CARD_HTML('leaper', uuid, 'Leaper');

    const freebies = parseFreebiesList(html);

    expect(freebies).toHaveLength(1);
    expect(freebies[0]).toEqual({
      productId: uuid,
      slug: 'leaper',
      game: {
        title: 'Leaper',
        platform: Platforms.IndieGala,
        link: 'https://freebies.indiegala.com/leaper',
        img: `https://www.indiegalacdn.com/imgs/devs/freebies/products/${uuid}/prodmain/1759920499.png`,
      },
    });
  });

  it('parses multiple cards on the same page', () => {
    const html = [
      CARD_HTML('battle-ram', '25bb9ba0-56e4-4c68-92b1-55bf43db7a52', 'Battle Ram'),
      CARD_HTML('leaper', 'a1db8f5b-f9c3-4004-84fc-ce90d0bb5872', 'Leaper'),
    ].join('\n');

    const freebies = parseFreebiesList(html);

    expect(freebies.map((f) => f.slug)).toEqual(['battle-ram', 'leaper']);
  });

  it('returns an empty array when no cards are present', () => {
    expect(parseFreebiesList('<div>no freebies today</div>')).toEqual([]);
  });

  it('skips a card missing a title or product id rather than throwing', () => {
    const html = `
      <div class="products-col-inner">
        <a class="fit-click" href="https://freebies.indiegala.com/broken"></a>
        <figure class="product-img"><img data-img-src="https://www.indiegalacdn.com/imgs/broken.png"/></figure>
        <figcaption><div class="left product-title"></div></figcaption>
      </div>`;
    expect(parseFreebiesList(html)).toEqual([]);
  });
});
