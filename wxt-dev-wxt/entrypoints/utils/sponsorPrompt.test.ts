// @vitest-environment node
import { describe, it, expect, beforeEach } from 'vitest';
import { fakeBrowser } from 'wxt/testing';
import { getStorageItem } from '@/entrypoints/hooks/useStorage';
import { saveReviewAnswer } from './reviewPrompt';
import {
  choosePrompt,
  sponsorAndOpen,
  SPONSOR_MILESTONE_URL,
  SPONSOR_PROMPT_MIN_CLAIMED,
  SPONSOR_PROMPT_REVIEW_GAP_MS,
  type PromptState,
} from './sponsorPrompt';

const NOW = 1_800_000_000_000;
const chromeEnv = { isFirefox: false, extensionId: 'mndghaafpgiinfecbbbcppppiblmjepk' };
const unknownEnv = { isFirefox: false, extensionId: 'devbuilddevbuilddevbuilddevbuild' };

const state = (over: Partial<PromptState> = {}): PromptState => ({
  claimedCount: 25,
  reviewAnswer: 'dismissed',
  reviewAnsweredAt: NOW - SPONSOR_PROMPT_REVIEW_GAP_MS,
  sponsorAnswer: null,
  now: NOW,
  env: chromeEnv,
  ...over,
});

describe('choosePrompt', () => {
  it('shows the sponsor card at the threshold once the review gap has passed', () => {
    expect(choosePrompt(state({ claimedCount: SPONSOR_PROMPT_MIN_CLAIMED }))).toBe('sponsor');
  });

  it('stays hidden below the threshold', () => {
    expect(choosePrompt(state({ claimedCount: SPONSOR_PROMPT_MIN_CLAIMED - 1 }))).toBeNull();
  });

  it('waits until 7 days after the review answer', () => {
    expect(choosePrompt(state({ reviewAnsweredAt: NOW - SPONSOR_PROMPT_REVIEW_GAP_MS + 1 }))).toBeNull();
    expect(choosePrompt(state({ reviewAnsweredAt: NOW - 1000 }))).toBeNull();
  });

  it('treats a review answered before timestamps were recorded as old enough', () => {
    expect(choosePrompt(state({ reviewAnsweredAt: undefined }))).toBe('sponsor');
  });

  it('shows no sponsor card while the review is unanswered on a build that has one', () => {
    expect(choosePrompt(state({ reviewAnswer: null, reviewAnsweredAt: undefined, claimedCount: 5 }))).toBe('review');
  });

  it('never shows both: an unanswered review wins even far past the sponsor threshold', () => {
    expect(choosePrompt(state({ reviewAnswer: null, reviewAnsweredAt: undefined, claimedCount: 500 }))).toBe('review');
  });

  it('skips the review gap when the build has no review card (unknown id)', () => {
    expect(choosePrompt(state({ env: unknownEnv, reviewAnswer: null, reviewAnsweredAt: undefined }))).toBe('sponsor');
    expect(choosePrompt(state({ env: unknownEnv, reviewAnswer: null, claimedCount: 19 }))).toBeNull();
  });

  it('stays hidden forever after either sponsor answer', () => {
    expect(choosePrompt(state({ sponsorAnswer: 'clicked' }))).toBeNull();
    expect(choosePrompt(state({ sponsorAnswer: 'dismissed' }))).toBeNull();
  });

  it('applies on Firefox the same way as Chrome', () => {
    const firefox = { isFirefox: true, extensionId: '{116f2aed-395e-42cd-8bf1-1b221519911d}' };
    expect(choosePrompt(state({ env: firefox }))).toBe('sponsor');
  });
});

describe('sponsor persistence', () => {
  beforeEach(() => {
    fakeBrowser.reset();
  });

  it('has stored "clicked" by the time the sponsor tab opens', async () => {
    let storedWhenOpened: unknown = 'never opened';
    let openedUrl = '';

    await sponsorAndOpen(async (url) => {
      openedUrl = url;
      storedWhenOpened = await getStorageItem('sponsorPrompt');
    });

    expect(storedWhenOpened).toBe('clicked');
    expect(openedUrl).toBe(SPONSOR_MILESTONE_URL);
  });

  it('records when the review prompt was answered', async () => {
    await saveReviewAnswer('rated', NOW);

    expect(await getStorageItem('reviewPrompt')).toBe('rated');
    expect(await getStorageItem('reviewPromptAnsweredAt')).toBe(NOW);
  });
});
