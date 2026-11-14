import { describe, expect, it } from 'vitest';
import { HEALTH_DETAIL_KEYS } from '@/entrypoints/utils/health';
import { MessageKey, t } from '@/entrypoints/utils/i18n';
import { PENDING_REASON_KEYS } from '@/entrypoints/utils/pendingRedemptions';

// These message keys are written to storage (a pending redemption's
// reasonKey, a store warning's detailKey) and read back by whichever version
// is installed later. Renaming or removing one makes entries already in
// users' storage lose their explanation, silently. So this list is pinned:
// a key may be added, but renaming one needs the old key kept in every
// catalogue (or a storage migration), not just an edit here.
const STORED_PENDING_REASON_KEYS = [
  'pendingReasonGiftNoKey',
  'pendingReasonGiftNotShown',
  'pendingReasonGiftPageNotOpened',
  'pendingReasonKeyNotShown',
  'pendingReasonNotSteamKey',
  'pendingReasonSteamFailed',
  'pendingReasonSteamInvalid',
  'pendingReasonSteamNeedsBaseGame',
  'pendingReasonSteamRateLimited',
  'pendingReasonSteamRegion',
  'pendingReasonSteamSignedOut',
  'pendingReasonSteamUnfinished',
  'pendingReasonSteamUsed',
];

const STORED_HEALTH_DETAIL_KEYS = [
  'healthEpicCaptcha',
  'healthEpicCheckoutUnfinished',
  'healthEpicGetButtonMissing',
];

describe('message keys written to storage', () => {
  it('are exactly the pinned pending-redemption reasons', () => {
    expect([...PENDING_REASON_KEYS].sort()).toEqual(STORED_PENDING_REASON_KEYS);
  });

  it('are exactly the pinned store-warning explanations', () => {
    expect([...HEALTH_DETAIL_KEYS].sort()).toEqual(STORED_HEALTH_DETAIL_KEYS);
  });

  it('all still have text in the English catalogue', () => {
    const missing = [...STORED_PENDING_REASON_KEYS, ...STORED_HEALTH_DETAIL_KEYS]
      .filter((key) => t(key as MessageKey) === '');
    expect(missing).toEqual([]);
  });
});
