// @vitest-environment node
import { describe, it, expect } from 'vitest';
import {
  areDatesDifferent,
  didEnoughTimePass,
  isActive,
  shouldCheckPrimeGamingToday,
} from './scheduling';

describe('areDatesDifferent', () => {
  it('is true for different calendar days', () => {
    expect(areDatesDifferent('2026-01-01T12:00:00Z', '2026-06-15T12:00:00Z')).toBe(true);
  });

  it('is false for the same instant', () => {
    expect(areDatesDifferent('2026-01-01T12:00:00Z', '2026-01-01T12:00:00Z')).toBe(false);
  });

  it('is false when the first date is empty (never claimed)', () => {
    expect(areDatesDifferent('', '2026-06-15T12:00:00Z')).toBe(false);
  });
});

describe('didEnoughTimePass', () => {
  it('is true when more than the required minutes elapsed', () => {
    const twoHoursAgo = new Date(Date.now() - 120 * 60 * 1000).toISOString();
    expect(didEnoughTimePass(twoHoursAgo, 60)).toBe(true);
  });

  it('is false when not enough time has passed', () => {
    const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    expect(didEnoughTimePass(fiveMinAgo, 60)).toBe(false);
  });
});

describe('isActive', () => {
  // Regression: `active` isn't persisted to storage until OnButton's
  // useStorage effect first mounts, so a fresh install (or any raw storage
  // read before the popup has ever opened) must not treat "unset" as "off".
  it('is true when unset (fresh install, never persisted)', () => {
    expect(isActive(undefined)).toBe(true);
    expect(isActive(null)).toBe(true);
  });

  it('is true when explicitly enabled', () => {
    expect(isActive(true)).toBe(true);
  });

  it('is false only when explicitly disabled', () => {
    expect(isActive(false)).toBe(false);
  });
});

describe('shouldCheckPrimeGamingToday', () => {
  it('is true when Prime Gaming has never been checked before', () => {
    // 2026-09-19 is a Saturday — not a check day — proving "never checked"
    // overrides the day-of-week restriction entirely.
    expect(shouldCheckPrimeGamingToday(null, new Date('2026-09-19T12:00:00Z'))).toBe(true);
  });

  it('is false when already checked earlier the same calendar day, even on a Thursday', () => {
    const lastCheck = '2026-09-17T08:00:00Z';
    const now = new Date('2026-09-17T18:00:00Z');
    expect(shouldCheckPrimeGamingToday(lastCheck, now)).toBe(false);
  });

  it('is true on a Thursday once the calendar day has changed', () => {
    const lastCheck = '2026-09-16T12:00:00Z'; // Wednesday
    const now = new Date('2026-09-17T12:00:00Z'); // Thursday
    expect(shouldCheckPrimeGamingToday(lastCheck, now)).toBe(true);
  });

  it('is true on a Friday once the calendar day has changed', () => {
    const lastCheck = '2026-09-17T12:00:00Z'; // Thursday
    const now = new Date('2026-09-18T12:00:00Z'); // Friday
    expect(shouldCheckPrimeGamingToday(lastCheck, now)).toBe(true);
  });

  it('is false on a non-Thu/Fri day within the catch-up window', () => {
    const lastCheck = '2026-09-18T12:00:00Z'; // Friday
    const now = new Date('2026-09-19T12:00:00Z'); // Saturday, 1 day later
    expect(shouldCheckPrimeGamingToday(lastCheck, now)).toBe(false);
  });

  it('is true on a non-Thu/Fri day once the catch-up interval is exceeded', () => {
    const lastCheck = '2026-09-13T12:00:00Z'; // Sunday
    const now = new Date('2026-09-19T12:00:00Z'); // Saturday, 6 days later
    expect(shouldCheckPrimeGamingToday(lastCheck, now)).toBe(true);
  });
});
