import { afterEach, describe, it, expect, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing';
import { claimedCountLabel, gameDateLabel, healthTooltip, pendingReasonText, platformLabel } from './popupText';
import { HealthDetailKey, HealthError } from './health';
import { PendingReasonKey, PendingRedemption } from './pendingRedemptions';
import { Platforms } from '../enums/platforms';
import { FreeGame } from '../types/freeGame';

// Local noon: the labels are in the browser's own time zone, so UTC instants
// would land on another day east of about UTC+8.
function localNoon(year: number, month: number, day: number): string {
  return new Date(year, month - 1, day, 12).toISOString();
}

const NOW = new Date(localNoon(2026, 11, 8));

function game(overrides: Partial<FreeGame> = {}): FreeGame {
  return { title: 'T', platform: Platforms.Epic, link: 'https://x', img: '', ...overrides };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('claimedCountLabel', () => {
  it('uses the singular for one game', () => {
    expect(claimedCountLabel(1)).toBe('1 game claimed');
  });

  it('uses the plural otherwise, zero included', () => {
    expect(claimedCountLabel(0)).toBe('0 games claimed');
    expect(claimedCountLabel(47)).toBe('47 games claimed');
  });
});

describe('platformLabel', () => {
  it('is the platform alone for a store giveaway', () => {
    expect(platformLabel(game({ platform: Platforms.Steam }))).toBe('Steam');
  });

  it('names the store a Prime Gaming offer goes to', () => {
    expect(platformLabel(game({ platform: Platforms.PrimeGaming, store: 'GOG' }))).toBe('Prime Gaming → GOG');
  });
});

describe('gameDateLabel', () => {
  it('says until when a current giveaway is free', () => {
    expect(gameDateLabel(game({ endDate: localNoon(2026, 11, 13) }), NOW, 'en-US')).toBe('Free until Nov 13');
  });

  it('gives an upcoming giveaway its date range', () => {
    const upcoming = game({ future: true, startDate: localNoon(2026, 11, 13), endDate: localNoon(2026, 11, 20) });
    expect(gameDateLabel(upcoming, NOW, 'en-US')).toBe('Nov 13 – Nov 20');
  });

  it('gives an upcoming giveaway without an end its start', () => {
    expect(gameDateLabel(game({ future: true, startDate: localNoon(2026, 11, 13) }), NOW, 'en-US')).toBe('From Nov 13');
  });

  it('adds the year when a date falls in another year', () => {
    expect(gameDateLabel(game({ endDate: localNoon(2027, 1, 2) }), NOW, 'en-US')).toBe('Free until Jan 2, 2027');
  });

  // A German browser shown the English catalogue: "Free until 13. Nov."
  // would mix two languages in one line.
  it("formats the date in the catalogue's language, not the browser's", () => {
    vi.spyOn(fakeBrowser.i18n, 'getUILanguage').mockReturnValue('de');

    expect(gameDateLabel(game({ endDate: localNoon(2026, 11, 13) }), NOW)).toBe('Free until Nov 13');
  });

  it('has no label without dates', () => {
    expect(gameDateLabel(game(), NOW, 'en-US')).toBeNull();
  });

  // Epic's formatter writes new Date(0) when a promotion has no end date.
  it('ignores the epoch and unparseable dates', () => {
    expect(gameDateLabel(game({ endDate: '1970-01-01T00:00:00.000Z' }), NOW, 'en-US')).toBeNull();
    expect(gameDateLabel(game({ endDate: 'soon' }), NOW, 'en-US')).toBeNull();
    expect(gameDateLabel(game({ future: true, startDate: '1970-01-01T00:00:00.000Z' }), NOW, 'en-US')).toBeNull();
  });
});

describe('healthTooltip', () => {
  const AT = '2026-11-13T09:30:00.000Z';
  const time = new Date(AT).toLocaleString('en-US');
  const error = (overrides: Partial<HealthError>): HealthError => ({ problem: 'captcha', detail: '', at: AT, ...overrides });

  it('gives a claim tab\'s explanation in the catalogue\'s words, then when', () => {
    expect(healthTooltip(error({ detailKey: 'healthEpicCaptcha' }), 'en-US'))
      .toBe(`Epic wants a captcha solved in its open tab to finish a claim (${time})`);
  });

  it('keeps a check\'s own diagnostic as it is', () => {
    expect(healthTooltip(error({ problem: 'network', detail: 'Failed to fetch' }), 'en-US')).toBe(`Failed to fetch (${time})`);
  });

  it('asks for an update when the store changed', () => {
    expect(healthTooltip(error({ problem: 'changed', detailKey: 'healthEpicGetButtonMissing' }), 'en-US'))
      .toBe(`Couldn't find the "Get" button on a free game's page (${time}). The extension needs an update; click to report it.`);
  });

  // A key a later release renamed resolves to "": the tooltip must not
  // become " (11/13/2026, ...)".
  it('falls back to the warning\'s name when a stored explanation no longer resolves', () => {
    expect(healthTooltip(error({ detailKey: 'renamedKey' as HealthDetailKey }), 'en-US')).toBe(`Needs captcha (${time})`);
    expect(healthTooltip(error({ problem: 'unfinished' }), 'en-US')).toBe(`Claim unfinished (${time})`);
  });
});

describe('pendingReasonText', () => {
  const entry = (overrides: Partial<PendingRedemption>): PendingRedemption =>
    ({ code: 'K', platform: 'Steam', title: 'T', redeemUrl: 'https://x', addedAt: '2026-11-13T09:30:00.000Z', ...overrides });

  it('translates a stored reason key', () => {
    expect(pendingReasonText(entry({ reasonKey: 'pendingReasonSteamSignedOut' }))).toBe('Sign in to Steam, then activate it');
  });

  it('shows the English reason earlier versions stored', () => {
    expect(pendingReasonText(entry({ reason: 'Steam says the key isn\'t valid' }))).toBe('Steam says the key isn\'t valid');
  });

  it('gives nothing, not an empty line, when a stored key no longer resolves', () => {
    expect(pendingReasonText(entry({ reasonKey: 'renamedKey' as PendingReasonKey }))).toBeUndefined();
    expect(pendingReasonText(entry({}))).toBeUndefined();
  });
});
