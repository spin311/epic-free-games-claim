import { describe, it, expect } from 'vitest';
import { hasEnded, withoutEnded } from './gameDates';
import { Platforms } from '../enums/platforms';
import { FreeGame } from '../types/freeGame';

const NOW = new Date('2026-11-09T12:00:00.000Z');

function game(overrides: Partial<FreeGame> = {}): FreeGame {
  return { title: 'T', platform: Platforms.PrimeGaming, link: 'https://x', img: '', ...overrides };
}

describe('hasEnded', () => {
  it('is true once the end date has passed', () => {
    expect(hasEnded(game({ endDate: '2026-10-28T17:00:00.000Z' }), NOW)).toBe(true);
  });

  it('is true at the end instant itself', () => {
    expect(hasEnded(game({ endDate: NOW.toISOString() }), NOW)).toBe(true);
  });

  it('is false while the game is still free', () => {
    expect(hasEnded(game({ endDate: '2026-11-25T18:00:00.000Z' }), NOW)).toBe(false);
  });

  it('is false without an end date: Steam, GOG and IndieGala give none', () => {
    expect(hasEnded(game({ platform: Platforms.Steam }), NOW)).toBe(false);
  });

  it('is false for the epoch date Epic writes when a promotion has no end', () => {
    expect(hasEnded(game({ platform: Platforms.Epic, endDate: new Date(0).toISOString() }), NOW)).toBe(false);
  });

  it('is false for an end date that is not a date', () => {
    expect(hasEnded(game({ endDate: 'soon' }), NOW)).toBe(false);
  });
});

describe('withoutEnded', () => {
  // Regression (3.5.0, Firefox): Prime Gaming kept listing claimed offers
  // that ended weeks before, because the list is only rewritten by a lookup
  // that finds a Prime account.
  it('drops the games whose giveaway is over and keeps the rest in order', () => {
    const games = [
      game({ title: 'Ad Infinitum', endDate: '2026-11-25T18:00:00.000Z', claimed: true }),
      game({ title: 'Hue', endDate: '2026-10-28T17:00:00.000Z', claimed: true }),
      game({ title: 'Asleep: Act 1', platform: Platforms.Steam }),
      game({ title: 'DOOM', endDate: '2026-11-04T18:00:00.000Z', claimed: true }),
    ];

    expect(withoutEnded(games, NOW).map((g) => g.title)).toEqual(['Ad Infinitum', 'Asleep: Act 1']);
  });

  it('keeps an upcoming game until its giveaway ends', () => {
    const upcoming = game({ future: true, startDate: '2026-11-12T16:00:00.000Z', endDate: '2026-11-19T16:00:00.000Z' });

    expect(withoutEnded([upcoming], NOW)).toEqual([upcoming]);
  });

  it('leaves the list it was given untouched', () => {
    const games = Object.freeze([game({ endDate: '2026-10-28T17:00:00.000Z' })]);

    expect(withoutEnded(games, NOW)).toEqual([]);
    expect(games).toHaveLength(1);
  });
});
