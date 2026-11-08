import { describe, it, expect } from 'vitest';
import { claimedCountLabel, gameDateLabel, platformLabel } from './popupText';
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
