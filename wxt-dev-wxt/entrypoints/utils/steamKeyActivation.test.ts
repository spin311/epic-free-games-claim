import { describe, it, expect } from 'vitest';
import {
  classifySteamKeyError,
  isSteamKeyDone,
  readSteamKeyResult,
  steamActivationUrl,
} from './steamKeyActivation';

describe('steamActivationUrl', () => {
  // Steam fills the key in from ?key= (confirmed live, Nov 2026).
  it('opens Steam\'s activation page with the key filled in', () => {
    expect(steamActivationUrl('AAAAA-BBBBB-CCCCC')).toBe('https://store.steampowered.com/account/registerkey?key=AAAAA-BBBBB-CCCCC');
  });
});

// The messages Steam's registerkey.js shows for each purchase result code.
describe('classifySteamKeyError', () => {
  it.each([
    ['This Steam account already owns the product(s) contained in this offer.', 'owned'],
    ['The product code you\'ve entered has already been activated by a different Steam account.', 'used'],
    ['The product code you\'ve entered is not valid or is not a product code.', 'invalid'],
    ['There have been too many recent activation attempts from this account or Internet address.', 'rate-limited'],
    ['Sorry, but Some Game is not available for purchase in this country.', 'region'],
    ['The product code you\'ve entered requires ownership of another product before activation.', 'needs-base-game'],
    ['An unexpected error has occurred.  Your product code has not been redeemed.', 'failed'],
  ])('reads "%s" as %s', (message, outcome) => {
    expect(classifySteamKeyError(message)).toBe(outcome);
  });
});

const page = (receiptDisplay: string, error: string) => {
  const html = `
    <div id="registerkey_form"><input id="product_key" value="AAAAA-BBBBB-CCCCC"></div>
    <span id="error_display" style="display: ${error ? 'block' : 'none'}">${error}</span>
    <div id="receipt_form" style="display: ${receiptDisplay}">Activation Successful!
      <div id="registerkey_productlist"><div class="registerkey_lineitem">Some Game</div></div>
    </div>`;
  return new DOMParser().parseFromString(html, 'text/html');
};

describe('readSteamKeyResult', () => {
  it('reads a successful activation and what it added', () => {
    expect(readSteamKeyResult(page('', ''))).toEqual({ outcome: 'activated', products: ['Some Game'], message: '' });
  });

  it('reads a refusal from the error box', () => {
    const result = readSteamKeyResult(page('none', 'This Steam account already owns the product(s) contained in this offer.'));
    expect(result?.outcome).toBe('owned');
  });

  it('is null while Steam hasn\'t answered yet', () => {
    expect(readSteamKeyResult(page('none', ''))).toBeNull();
  });
});

describe('isSteamKeyDone', () => {
  it('counts an activation and an already-owned game as done, nothing else', () => {
    expect(isSteamKeyDone('activated')).toBe(true);
    expect(isSteamKeyDone('owned')).toBe(true);
    expect(isSteamKeyDone('signed-out')).toBe(false);
    expect(isSteamKeyDone('rate-limited')).toBe(false);
  });
});
