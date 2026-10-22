export function areDatesDifferent(date1: string, date2: string): boolean {
  return !!date1 && new Date(date1).toDateString() !== new Date(date2).toDateString();
}

export function didEnoughTimePass(lastOpened: string, requiredMinutes: number): boolean {
  const lastDate = new Date(lastOpened);
  const now = new Date();
  const minutesElapsed = (now.getTime() - lastDate.getTime()) / (1000 * 60);
  return minutesElapsed >= requiredMinutes;
}

// `active` defaults to enabled (see OnButton's useStorage default) — unset
// storage (nothing persisted yet, e.g. before the popup has ever rendered)
// must read as active, not inactive. The same asymmetric-default class of bug
// already fixed for the platform toggles in resolvePlatformToggles: without
// this, a fresh install's alarm never gets created and its first scheduled
// check never runs, since nothing writes `active` to storage until OnButton
// itself mounts.
export function isActive(active: unknown): boolean {
  return active !== false;
}

// Confirmed (against Prime Gaming's own reference scraper and third-party
// lineup trackers): new titles land almost exclusively on Thursdays — a larger
// batch on the month's first Thursday, then a weekly trickle — with only rare
// off-cycle bonus adds. These gates apply only to the claims-page fallback
// (see checkPrimeGaming): opening a real tab on every claimFrequency tick
// (which can be as often as hourly) finds nothing new on 5 of 7 days, while
// the normal background lookup opens no tab and isn't gated. Restricting the
// fallback to Thu/Fri (a
// one-day buffer for late/timezone drops) cuts that overhead without missing
// drops; the interval catch-up guarantees an off-cycle title or a missed
// Thu/Fri window is never more than PRIME_GAMING_MAX_CHECK_INTERVAL_DAYS stale.
export const PRIME_GAMING_CHECK_DAYS_OF_WEEK = [4, 5]; // Date#getDay(): Thu, Fri
export const PRIME_GAMING_MAX_CHECK_INTERVAL_DAYS = 6;

export function shouldCheckPrimeGamingToday(lastCheck: string | null, now: Date): boolean {
  if (!lastCheck) return true;
  if (!areDatesDifferent(lastCheck, now.toISOString())) return false;

  const daysSinceLastCheck = (now.getTime() - new Date(lastCheck).getTime()) / (24 * 60 * 60 * 1000);
  if (daysSinceLastCheck >= PRIME_GAMING_MAX_CHECK_INTERVAL_DAYS) return true;

  return PRIME_GAMING_CHECK_DAYS_OF_WEEK.includes(now.getDay());
}
