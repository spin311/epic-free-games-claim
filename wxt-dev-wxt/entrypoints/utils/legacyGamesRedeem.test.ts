import { describe, it, expect } from 'vitest';
import {
  buildLegacyRedeemUrl,
  fillLegacyRedeemForm,
  findLegacyRedeemForm,
  findLegacyRedeemUrl,
  isFreshLegacySubmission,
  LEGACY_SUBMISSION_MAX_AGE_MS,
  LegacySubmission,
  matchLegacySubmission,
  normalizeEmail,
  readLegacyRedeemError,
  readLegacyRedeemResult,
} from './legacyGamesRedeem';

function docFrom(html: string): Document {
  return new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
}

// Trimmed from the live promo.legacygames.com/the-da-vinci-cryptex-luna/ form
// (Oct 2026): a plain POST form, newsletter opt-in pre-checked.
const REDEEM_FORM = `
<form action="https://promo.legacygames.com/promotion-processing/order-management.php" method="post">
  <input required type="text" name="coupon_code" id="primedeal_game_code">
  <input required type="email" name="email" id="primedeal_email" value="">
  <input required type="email" name="email_validate" id="primedeal_email_validate" value="">
  <input type="hidden" name="promotion_key" value="598032">
  <input type="checkbox" name="newsletter_sub" id="primedeal_newsletter" value="2" checked="checked">
  <input type="submit" id="submitbutton" value="Submit">
</form>`;

const CLAIM_PAGE = 'https://luna.amazon.com/claims/the-da-vinci-cryptex-legacy/dp/amzn1.pg.item.6cd3cd34/details';

describe('normalizeEmail', () => {
  it('trims a valid address', () => {
    expect(normalizeEmail('  me@example.com ')).toBe('me@example.com');
  });

  it.each([[''], ['   '], ['not-an-email'], ['a@b'], ['two words@example.com'], [null], [undefined], [42]])(
    'rejects %j',
    (value) => {
      expect(normalizeEmail(value)).toBeNull();
    },
  );
});

describe('findLegacyRedeemUrl', () => {
  // Confirmed live: the offer page's "Click here to enter your redemption
  // code" step links to the game's own promo page.
  it("uses the offer page's own link to the promo page", () => {
    const doc = docFrom('<a href="https://legacygames.com/">Legacy Games</a><a href="https://promo.legacygames.com/the-da-vinci-cryptex-luna/">Click here</a>');
    expect(findLegacyRedeemUrl(doc, CLAIM_PAGE)).toBe('https://promo.legacygames.com/the-da-vinci-cryptex-luna/');
  });

  it('derives the promo page from the claim slug when the page has no such link', () => {
    expect(findLegacyRedeemUrl(docFrom('<p>Success</p>'), CLAIM_PAGE))
        .toBe('https://promo.legacygames.com/the-da-vinci-cryptex-luna/');
  });

  it('returns null for a page that is not a Legacy Games claim', () => {
    expect(findLegacyRedeemUrl(docFrom(''), 'https://luna.amazon.com/claims/doom-gog/dp/x')).toBeNull();
  });
});

describe('buildLegacyRedeemUrl', () => {
  it('carries the code and title over to the promo page', () => {
    const url = new URL(buildLegacyRedeemUrl('https://promo.legacygames.com/the-da-vinci-cryptex-luna/', 'ABC-123', 'The Da Vinci Cryptex'));
    expect(url.origin + url.pathname).toBe('https://promo.legacygames.com/the-da-vinci-cryptex-luna/');
    expect(url.searchParams.get('extCode')).toBe('ABC-123');
    expect(url.searchParams.get('extTitle')).toBe('The Da Vinci Cryptex');
  });
});

describe('findLegacyRedeemForm', () => {
  it('finds every field of the live form', () => {
    const fields = findLegacyRedeemForm(docFrom(REDEEM_FORM));
    expect(fields?.code.name).toBe('coupon_code');
    expect(fields?.email.name).toBe('email');
    expect(fields?.emailConfirm.name).toBe('email_validate');
    expect(fields?.newsletter?.name).toBe('newsletter_sub');
    expect(fields?.form.tagName).toBe('FORM');
  });

  it('returns null when the code field is missing (markup changed)', () => {
    expect(findLegacyRedeemForm(docFrom('<form><input name="email"></form>'))).toBeNull();
  });
});

describe('fillLegacyRedeemForm', () => {
  it('fills the code and both email fields, and opts out of the newsletter', () => {
    const fields = findLegacyRedeemForm(docFrom(REDEEM_FORM))!;

    fillLegacyRedeemForm(fields, 'ABC-123', 'me@example.com');

    expect(fields.code.value).toBe('ABC-123');
    expect(fields.email.value).toBe('me@example.com');
    expect(fields.emailConfirm.value).toBe('me@example.com');
    expect(fields.newsletter?.checked).toBe(false);
  });

  // No email configured: the code is still filled so the user only has to
  // type their email and press Submit.
  it('fills only the code when no email is given', () => {
    const fields = findLegacyRedeemForm(docFrom(REDEEM_FORM))!;

    fillLegacyRedeemForm(fields, 'ABC-123', null);

    expect(fields.code.value).toBe('ABC-123');
    expect(fields.email.value).toBe('');
    expect(fields.newsletter?.checked).toBe(false);
  });
});

describe('readLegacyRedeemError', () => {
  // Confirmed live: the promo page's own script shows atob(?error=...).
  it('decodes the base64 error message the promo page shows', () => {
    expect(readLegacyRedeemError(`?error=${encodeURIComponent(btoa('Invalid code'))}`)).toBe('Invalid code');
  });

  it("restores a '+' that query-string decoding turned into a space", () => {
    const encoded = btoa('Code already used>>'); // contains a '+'
    expect(encoded).toContain('+');
    expect(readLegacyRedeemError(`?error=${encoded}`)).toBe('Code already used>>');
  });

  it('still reports an error whose value is not valid base64', () => {
    expect(readLegacyRedeemError('?error=%%%')).toBe('Legacy Games rejected the code');
  });

  it('returns null without an error param', () => {
    expect(readLegacyRedeemError('?extCode=ABC')).toBeNull();
  });
});

describe('readLegacyRedeemResult', () => {
  it('reads an error redirect as rejected', () => {
    const result = readLegacyRedeemResult(`https://promo.legacygames.com/the-da-vinci-cryptex-luna/?error=${btoa('Invalid code')}`, docFrom(REDEEM_FORM));
    expect(result).toEqual({ result: 'rejected', message: 'Invalid code' });
  });

  it('reads landing back on the code form as rejected', () => {
    expect(readLegacyRedeemResult('https://promo.legacygames.com/the-da-vinci-cryptex-luna/', docFrom(REDEEM_FORM)).result).toBe('rejected');
  });

  // Confirmed live (Oct 2026): a successful POST 302s to a per-game page on
  // legacygames.com (not promo.) that thanks you for redeeming.
  it('reads the Legacy Games thank-you page as redeemed', () => {
    const doc = docFrom(`
      <h2>The best casual games, in affordable bundles.</h2>
      <h2>Thanks for redeeming your Amazon Luna code! Here is how you can access your free game.</h2>
      <p>Sign into the Legacy Games Launcher using the email address you entered on the redemption page.</p>`);
    expect(readLegacyRedeemResult('https://legacygames.com/amazon-luna-x-legacy-games-the-da-vinci-cryptex/', doc))
        .toEqual({ result: 'redeemed' });
  });

  // An error redirect wins even if the page also carries the thank-you copy.
  it('prefers an error redirect over the thank-you copy', () => {
    const doc = docFrom('<h2>Thanks for redeeming your Amazon Luna code!</h2>');
    expect(readLegacyRedeemResult(`https://promo.legacygames.com/x/?error=${btoa('Used')}`, doc).result).toBe('rejected');
  });

  // Never guess success: an unrecognized page keeps the code pending.
  it('reads an unrecognized page as unconfirmed', () => {
    expect(readLegacyRedeemResult('https://legacygames.com/some-page/', docFrom('<h1>Hello</h1>')).result).toBe('unconfirmed');
  });
});

describe('isFreshLegacySubmission', () => {
  const now = new Date('2026-10-02T12:00:00Z');

  it('is true right after submitting', () => {
    expect(isFreshLegacySubmission({ submittedAt: '2026-10-02T11:59:30Z' }, now)).toBe(true);
  });

  // A stale stash must not hijack an unrelated later visit to legacygames.com.
  it('is false once the submission is older than the max age', () => {
    const old = new Date(now.getTime() - LEGACY_SUBMISSION_MAX_AGE_MS - 1000).toISOString();
    expect(isFreshLegacySubmission({ submittedAt: old }, now)).toBe(false);
  });

  it('is false for a malformed timestamp', () => {
    expect(isFreshLegacySubmission({ submittedAt: 'garbage' }, now)).toBe(false);
  });
});

describe('matchLegacySubmission', () => {
  const submission = (game: string, code: string): LegacySubmission => ({
    code,
    title: game,
    redeemUrl: `https://promo.legacygames.com/${game}-luna/?extCode=${code}`,
    submittedAt: '2026-10-02T12:00:00Z',
  });
  const cryptex = submission('the-da-vinci-cryptex', 'AAAAA-11111-BBBBB');
  const other = submission('mystery-manor', 'CCCCC-22222-DDDDD');

  // Two Legacy offers in one run overlap (tabs open 3s apart), so each
  // landing page must pick its own submission, not just the latest.
  it("matches the confirmed success page to its game's submission", () => {
    const landing = 'https://legacygames.com/amazon-luna-x-legacy-games-the-da-vinci-cryptex/';
    expect(matchLegacySubmission([other, cryptex], landing)).toBe(cryptex);
  });

  it("matches an error redirect back to its game's promo page", () => {
    const landing = `https://promo.legacygames.com/mystery-manor-luna/?error=${btoa('Invalid')}`;
    expect(matchLegacySubmission([other, cryptex], landing)).toBe(other);
  });

  it('falls back to the only pending submission when the URL names no game', () => {
    expect(matchLegacySubmission([cryptex], 'https://legacygames.com/amazon-luna-x-legacy-games-thanks/')).toBe(cryptex);
  });

  it('matches nothing when several are pending and none is named', () => {
    expect(matchLegacySubmission([cryptex, other], 'https://legacygames.com/amazon-luna-x-legacy-games-thanks/')).toBeNull();
  });

  it('matches nothing when nothing is pending', () => {
    expect(matchLegacySubmission([], 'https://legacygames.com/amazon-luna-x-legacy-games-the-da-vinci-cryptex/')).toBeNull();
  });
});
