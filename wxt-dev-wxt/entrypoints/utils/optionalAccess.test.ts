import { describe, it, expect, vi } from 'vitest';
import {
  ACCESS_GROUP_ORIGINS,
  AccessGroup,
  accessOrigins,
  requestOrigins,
  hasAccessFor,
  OPTIONAL_ORIGINS,
  readGrantedAccessGroups,
  PendingAccessRequest,
  toggleToCompleteAfterGrant,
  toggleWithAccess,
  withOptionalHostAccess,
} from './optionalAccess';

const REQUIRED_HOSTS = [
  'https://store.steampowered.com/*',
  'https://store-site-backend-static-ipv4.ak.epicgames.com/*',
];

// Fake permissions.contains: true only when every requested origin is granted.
function containsFor(grantedOrigins: string[]) {
  return vi.fn(async ({ origins = [] }: { origins?: string[] }) =>
      origins.every((origin) => grantedOrigins.includes(origin)));
}

describe('hasAccessFor', () => {
  it('needs only the platform group for a plain platform toggle', () => {
    expect(hasAccessFor('gogCheck', new Set<AccessGroup>(['gog']))).toBe(true);
    expect(hasAccessFor('gogCheck', new Set<AccessGroup>(['primeGaming']))).toBe(false);
  });

  it('gates the IndieGala wheel on the same group as IndieGala', () => {
    expect(hasAccessFor('indieGalaWheelCheck', new Set<AccessGroup>(['indieGala']))).toBe(true);
    expect(hasAccessFor('indieGalaWheelCheck', new Set<AccessGroup>())).toBe(false);
  });

  // gog.content.ts redeems a GOG-linked offer's code, so Prime alone isn't enough.
  it('needs both Prime Gaming and the redeem store for a store-linked Prime toggle', () => {
    expect(hasAccessFor('primeGamingClaimGog', new Set<AccessGroup>(['primeGaming']))).toBe(false);
    expect(hasAccessFor('primeGamingClaimGog', new Set<AccessGroup>(['primeGaming', 'gog']))).toBe(true);
    expect(hasAccessFor('primeGamingClaimWindows', new Set<AccessGroup>(['primeGaming', 'gog']))).toBe(false);
    expect(hasAccessFor('primeGamingClaimWindows', new Set<AccessGroup>(['primeGaming', 'microsoft']))).toBe(true);
    expect(hasAccessFor('primeGamingClaimLegacy', new Set<AccessGroup>(['primeGaming', 'legacyGames']))).toBe(true);
  });

  it('needs only Prime Gaming for offers redeemed without one of our content scripts', () => {
    const primeOnly = new Set<AccessGroup>(['primeGaming']);
    expect(hasAccessFor('primeGamingClaimEpic', primeOnly)).toBe(true);
    expect(hasAccessFor('primeGamingClaimAmazonGames', primeOnly)).toBe(true);
    expect(hasAccessFor('primeGamingCheck', primeOnly)).toBe(true);
  });
});

describe('accessOrigins', () => {
  it('unions the origins of every group a toggle needs', () => {
    expect(accessOrigins('primeGamingClaimGog')).toEqual([
      ...ACCESS_GROUP_ORIGINS.primeGaming,
      ...ACCESS_GROUP_ORIGINS.gog,
    ]);
  });
});

describe('requestOrigins', () => {
  const PRIME_BUNDLE = [
    'https://gaming.amazon.com/*',
    'https://luna.amazon.com/*',
    'https://www.gog.com/*',
    'https://account.microsoft.com/*',
    'https://www.microsoft.com/store/purchase/buynowui/*',
    'https://legacygames.com/*',
    'https://promo.legacygames.com/*',
  ];

  // One prompt for Prime Gaming rather than one per store it can redeem on.
  it('asks for every Prime Gaming store at once, from any Prime Gaming toggle', () => {
    for (const toggle of ['primeGamingCheck', 'primeGamingClaimEpic', 'primeGamingClaimGog', 'primeGamingClaimLegacy'] as const) {
      expect([...requestOrigins(toggle)].sort()).toEqual([...PRIME_BUNDLE].sort());
    }
  });

  it('asks only for its own hosts outside Prime Gaming', () => {
    expect(requestOrigins('gogCheck')).toEqual(['https://www.gog.com/*']);
    expect(requestOrigins('indieGalaWheelCheck')).toEqual(accessOrigins('indieGalaWheelCheck'));
  });

  // What a toggle needs to work stays per store: a site removed later in the
  // browser's settings switches off only the options that depend on it.
  it('still only needs its own groups to count as granted', () => {
    expect(hasAccessFor('primeGamingClaimEpic', new Set<AccessGroup>(['primeGaming']))).toBe(true);
    expect(hasAccessFor('primeGamingClaimGog', new Set<AccessGroup>(['primeGaming']))).toBe(false);
  });
});

describe('readGrantedAccessGroups', () => {
  it('reports a group only when every one of its origins is granted', async () => {
    const contains = containsFor([
      ...ACCESS_GROUP_ORIGINS.gog,
      ACCESS_GROUP_ORIGINS.indieGala[0],
    ]);

    const granted = await readGrantedAccessGroups({ contains });

    expect([...granted]).toEqual(['gog']);
  });

  it('reports nothing on an install that never granted an optional host', async () => {
    expect((await readGrantedAccessGroups({ contains: containsFor([]) })).size).toBe(0);
  });
});

describe('toggleWithAccess', () => {
  type Pending = PendingAccessRequest | null;

  // Firefox only shows the prompt for a request made inside the user gesture,
  // i.e. before anything awaits, and may close the popup once it does.
  it('requests the toggle\'s origins synchronously, and remembers the request', () => {
    const calls: string[] = [];
    const request = vi.fn(() => { calls.push('request'); return new Promise<boolean>(() => {}); });

    toggleWithAccess('primeGamingClaimWindows', true, (value) => calls.push(`set:${value}`), { request },
        (pending: Pending) => calls.push(`pending:${pending?.toggle ?? null}`));

    expect(request).toHaveBeenCalledWith({ origins: requestOrigins('primeGamingClaimWindows') });
    expect(calls).toEqual(['request', 'pending:primeGamingClaimWindows']);
  });

  it('turns the flag on and forgets the request once access is granted', async () => {
    const values: boolean[] = [];
    const pending: Pending[] = [];

    toggleWithAccess('gogCheck', true, (value) => values.push(value), { request: async () => true },
        (request) => pending.push(request));
    await vi.waitFor(() => expect(values).toEqual([true]));

    expect(pending.at(-1)).toBeNull();
  });

  // A denial must leave nothing switched on: a flag set ahead of the answer
  // would come back to life the next time these hosts are granted for any
  // other feature.
  it('never turns the flag on when the user denies the request', async () => {
    const values: boolean[] = [];
    const pending: Pending[] = [];

    toggleWithAccess('gogCheck', true, (value) => values.push(value), { request: async () => false },
        (request) => pending.push(request));
    await vi.waitFor(() => expect(pending.at(-1)).toBeNull());

    expect(values).toEqual([]);
  });

  it('never turns the flag on when the request fails', async () => {
    const values: boolean[] = [];
    const pending: Pending[] = [];
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});

    toggleWithAccess('gogCheck', true, (value) => values.push(value), {
      request: async () => { throw new Error('Only permissions specified in the manifest may be requested'); },
    }, (request) => pending.push(request));
    await vi.waitFor(() => expect(pending.at(-1)).toBeNull());

    expect(values).toEqual([]);
    errors.mockRestore();
  });

  // Groups are shared between toggles (GOG and GOG-linked Prime offers), so
  // turning one off must never revoke what the other still uses.
  it('turning a toggle off only clears the flag, without requesting or removing anything', () => {
    const request = vi.fn();
    const values: boolean[] = [];

    toggleWithAccess('gogCheck', false, (value) => values.push(value), { request }, () => {});

    expect(request).not.toHaveBeenCalled();
    expect(values).toEqual([false]);
  });
});

describe('toggleToCompleteAfterGrant', () => {
  const NOW = new Date('2026-10-20T12:00:00.000Z');
  const ALL: ReadonlySet<AccessGroup> = new Set(['primeGaming', 'gog']);

  it('returns the requested toggle once all its groups are granted', () => {
    const pending = { toggle: 'primeGamingClaimGog', requestedAt: '2026-10-20T11:59:00.000Z' };
    expect(toggleToCompleteAfterGrant(pending, ALL, NOW)).toBe('primeGamingClaimGog');
  });

  it('returns null while one of its groups is still missing', () => {
    const pending = { toggle: 'primeGamingClaimGog', requestedAt: '2026-10-20T11:58:00.000Z' };
    expect(toggleToCompleteAfterGrant(pending, new Set<AccessGroup>(['gog']), NOW)).toBeNull();
  });

  // A prompt is answered within moments; an older request is more likely one
  // denied while the popup was closing, which a grant made some other way
  // (e.g. Firefox's add-on settings) must not revive.
  it('ignores a request too old to be what this grant answers', () => {
    const pending = { toggle: 'gogCheck', requestedAt: '2026-10-20T11:57:00.000Z' };
    expect(toggleToCompleteAfterGrant(pending, ALL, NOW)).toBeNull();
  });

  it('ignores anything that is not a pending request for a known toggle', () => {
    expect(toggleToCompleteAfterGrant(null, ALL, NOW)).toBeNull();
    expect(toggleToCompleteAfterGrant({ toggle: 'steamCheck', requestedAt: NOW.toISOString() }, ALL, NOW)).toBeNull();
    expect(toggleToCompleteAfterGrant({ toggle: 'gogCheck', requestedAt: 'not a date' }, ALL, NOW)).toBeNull();
  });
});

describe('withOptionalHostAccess', () => {
  const runtimeMatches = [
    'https://www.gog.com/*',
    'https://account.microsoft.com/billing/redeem*',
    'https://legacygames.com/amazon-luna-x-legacy-games-*',
  ];
  // What WXT generates: the config's hosts plus every runtime script's matches.
  const generated = {
    host_permissions: [...REQUIRED_HOSTS, ...runtimeMatches, 'https://luna.amazon.com/*'],
  };

  it('MV3: keeps only the required hosts and declares every group origin as optional', () => {
    const result = withOptionalHostAccess(generated, 3, runtimeMatches);

    expect(result.host_permissions).toEqual(REQUIRED_HOSTS);
    expect(result.optional_host_permissions).toEqual(OPTIONAL_ORIGINS);
    expect(result.optional_permissions).toBeUndefined();
  });

  // WXT strips optional_host_permissions while converting to MV2, after this
  // hook runs, so Firefox's optional origins must go in optional_permissions.
  it('MV2: declares the group origins in optional_permissions instead', () => {
    const result = withOptionalHostAccess({ ...generated, optional_permissions: ['notifications'] }, 2, runtimeMatches);

    expect(result.host_permissions).toEqual(REQUIRED_HOSTS);
    expect(result.optional_permissions).toEqual(['notifications', ...OPTIONAL_ORIGINS]);
    expect(result.optional_host_permissions).toBeUndefined();
  });

  it('covers every origin of every group exactly once', () => {
    const everyOrigin = Object.values(ACCESS_GROUP_ORIGINS).flat();
    expect([...OPTIONAL_ORIGINS].sort()).toEqual([...new Set(everyOrigin)].sort());
  });

  it('does not mutate the manifest it is given', () => {
    const manifest = { host_permissions: [...generated.host_permissions] };

    withOptionalHostAccess(manifest, 3, runtimeMatches);

    expect(manifest.host_permissions).toEqual(generated.host_permissions);
  });
});
