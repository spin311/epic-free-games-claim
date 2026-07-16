import { describe, it, expect } from 'vitest';
import {
  ClaimFrequency,
  ClaimFrequencyLabels,
  ClaimFrequencyMinutes,
} from './claimFrequency';

describe('ClaimFrequency maps', () => {
  it('defines a minutes interval for every frequency', () => {
    for (const freq of Object.values(ClaimFrequency)) {
      expect(ClaimFrequencyMinutes[freq]).toBeTypeOf('number');
    }
  });

  it('defines a human label for every frequency', () => {
    for (const freq of Object.values(ClaimFrequency)) {
      expect(ClaimFrequencyLabels[freq]).toBeTruthy();
    }
  });

  it('uses the expected alarm intervals', () => {
    expect(ClaimFrequencyMinutes[ClaimFrequency.HOURLY]).toBe(60);
    expect(ClaimFrequencyMinutes[ClaimFrequency.EVERY_6_HOURS]).toBe(360);
    expect(ClaimFrequencyMinutes[ClaimFrequency.EVERY_12_HOURS]).toBe(720);
    expect(ClaimFrequencyMinutes[ClaimFrequency.DAILY]).toBe(1440);
  });

  // BROWSER_START is handled via runtime.onStartup, not alarms, so its
  // interval is intentionally 0 (never scheduled as a periodic alarm).
  it('marks BROWSER_START with a zero interval', () => {
    expect(ClaimFrequencyMinutes[ClaimFrequency.BROWSER_START]).toBe(0);
  });
});
