// @vitest-environment node
import { describe, it, expect, beforeEach } from 'vitest';
import { fakeBrowser } from 'wxt/testing';
import { getStorageItem } from '@/entrypoints/hooks/useStorage';
import {
  getReviewUrl,
  shouldShowReviewPrompt,
  rateAndOpenReviewPage,
  saveReviewAnswer,
  REVIEW_PROMPT_MIN_CLAIMED,
} from './reviewPrompt';

const STORE_ID = 'mndghaafpgiinfecbbbcppppiblmjepk';
const chrome = { isFirefox: false, extensionId: STORE_ID };
const firefox = { isFirefox: true, extensionId: '{116f2aed-395e-42cd-8bf1-1b221519911d}' };
const unpacked = { isFirefox: false, extensionId: 'abcdefghijklmnopabcdefghijklmnop' };

describe('getReviewUrl', () => {
  it('returns the AMO reviews page on Firefox', () => {
    expect(getReviewUrl(firefox)).toBe('https://addons.mozilla.org/firefox/addon/free-game-claime-steam-epic/reviews/');
  });

  it('returns the Chrome Web Store reviews page for the store id', () => {
    expect(getReviewUrl(chrome)).toBe(
      `https://chromewebstore.google.com/detail/free-game-claimer-for-ste/${STORE_ID}/reviews`,
    );
  });

  it('returns null for any other Chromium id (unpacked, Edge listing)', () => {
    expect(getReviewUrl(unpacked)).toBeNull();
  });
});

describe('shouldShowReviewPrompt', () => {
  it('hides below the claimed threshold', () => {
    expect(shouldShowReviewPrompt(REVIEW_PROMPT_MIN_CLAIMED - 1, null, chrome)).toBe(false);
  });

  it('shows at the threshold when unanswered', () => {
    expect(shouldShowReviewPrompt(REVIEW_PROMPT_MIN_CLAIMED, null, chrome)).toBe(true);
    expect(shouldShowReviewPrompt(10, undefined, firefox)).toBe(true);
  });

  it('stays hidden forever after either answer', () => {
    expect(shouldShowReviewPrompt(50, 'rated', chrome)).toBe(false);
    expect(shouldShowReviewPrompt(50, 'dismissed', chrome)).toBe(false);
  });

  it('hides when there is no review page for this install', () => {
    expect(shouldShowReviewPrompt(50, null, unpacked)).toBe(false);
  });

  it('ignores unknown stored values and non-numeric counts', () => {
    expect(shouldShowReviewPrompt(5, 'garbage', chrome)).toBe(true);
    expect(shouldShowReviewPrompt(NaN, null, chrome)).toBe(false);
  });
});

describe('review answer persistence', () => {
  beforeEach(() => {
    fakeBrowser.reset();
  });

  it('has stored "rated" by the time the review tab opens', async () => {
    let storedWhenOpened: unknown = 'never opened';

    await rateAndOpenReviewPage('https://example.test/reviews', async () => {
      storedWhenOpened = await getStorageItem('reviewPrompt');
    });

    expect(storedWhenOpened).toBe('rated');
  });

  it('still opens the tab when saving fails', async () => {
    let opened = false;
    const original = fakeBrowser.storage.local.set;
    fakeBrowser.storage.local.set = () => Promise.reject(new Error('quota'));

    await rateAndOpenReviewPage('https://example.test', async () => { opened = true; });

    fakeBrowser.storage.local.set = original;
    expect(opened).toBe(true);
  });

  it('stores "dismissed"', async () => {
    await saveReviewAnswer('dismissed');
    expect(await getStorageItem('reviewPrompt')).toBe('dismissed');
  });
});
