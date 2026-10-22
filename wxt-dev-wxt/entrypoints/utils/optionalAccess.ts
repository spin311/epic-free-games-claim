// Every host beyond the two 2.6.1 shipped with is an optional permission, asked
// for from the popup when the user turns on the feature that needs it. Chrome
// disables an extension on update until the user approves any new install-time
// host warning, so adding these as required hosts would switch the extension
// off for every existing user.
//
// wxt.config.ts imports this module while the config loads, outside Vite, so it
// must stay free of runtime imports (no `browser`, no `@/` alias): the browser
// APIs are passed in by the caller instead.

export type AccessGroup = "gog" | "indieGala" | "primeGaming" | "microsoft" | "legacyGames";

export const ACCESS_GROUP_ORIGINS: Readonly<Record<AccessGroup, readonly string[]>> = {
  gog: ["https://www.gog.com/*"],
  indieGala: ["https://freebies.indiegala.com/*", "https://www.indiegala.com/*"],
  primeGaming: ["https://gaming.amazon.com/*", "https://luna.amazon.com/*"],
  // The account.microsoft.com redeem page embeds the actual redeem form as a
  // cross-origin iframe on this separate host — confirmed live.
  microsoft: ["https://account.microsoft.com/*", "https://www.microsoft.com/store/purchase/buynowui/*"],
  legacyGames: ["https://legacygames.com/*", "https://promo.legacygames.com/*"],
};

export const OPTIONAL_ORIGINS: readonly string[] = [...new Set(Object.values(ACCESS_GROUP_ORIGINS).flat())];

// Storage toggle -> the groups it can't work without. A store-linked Prime
// Gaming toggle also needs that store's group: its code is redeemed by our
// content script on the store's own page (GOG's by gog.content.ts), and
// claiming without it would reveal the code and then lose it on an un-scripted
// page. Epic and Amazon Games App offers are redeemed with no script of ours.
export const TOGGLE_ACCESS_GROUPS = {
  gogCheck: ["gog"],
  indieGalaCheck: ["indieGala"],
  indieGalaWheelCheck: ["indieGala"],
  primeGamingCheck: ["primeGaming"],
  primeGamingClaimEpic: ["primeGaming"],
  primeGamingClaimAmazonGames: ["primeGaming"],
  primeGamingClaimGog: ["primeGaming", "gog"],
  primeGamingClaimWindows: ["primeGaming", "microsoft"],
  primeGamingClaimLegacy: ["primeGaming", "legacyGames"],
} as const satisfies Record<string, readonly AccessGroup[]>;

export type AccessToggle = keyof typeof TOGGLE_ACCESS_GROUPS;

// The single rule everywhere (background and popup): a feature is effective
// only when its flag is on AND this holds. The flag alone is never enough —
// an update keeps every stored flag but grants none of these hosts.
export function hasAccessFor(toggle: AccessToggle, granted: ReadonlySet<AccessGroup>): boolean {
  return TOGGLE_ACCESS_GROUPS[toggle].every((group) => granted.has(group));
}

function originsOf(groups: readonly AccessGroup[]): string[] {
  return [...new Set(groups.flatMap((group) => ACCESS_GROUP_ORIGINS[group]))];
}

export function accessOrigins(toggle: AccessToggle): string[] {
  return originsOf(TOGGLE_ACCESS_GROUPS[toggle]);
}

// Every group some Prime Gaming toggle needs (Amazon's own hosts plus each
// store a Prime code is redeemed on).
const PRIME_GAMING_GROUPS: readonly AccessGroup[] = [...new Set(
    Object.values(TOGGLE_ACCESS_GROUPS)
        .filter((groups) => (groups as readonly AccessGroup[]).includes("primeGaming"))
        .flat()
)];

// What turning a toggle on asks for. Any Prime Gaming toggle asks for every
// Prime Gaming store at once, so enabling it is one prompt rather than one per
// store option. What each toggle *needs* stays per store (hasAccessFor), so a
// site removed later in the browser's settings switches off only the options
// that depend on it.
export function requestOrigins(toggle: AccessToggle): string[] {
  const groups: readonly AccessGroup[] = TOGGLE_ACCESS_GROUPS[toggle];
  return originsOf(groups.includes("primeGaming") ? PRIME_GAMING_GROUPS : groups);
}

type OriginPermissions = { origins?: string[] };

export type PermissionsApi = {
  contains(permissions: OriginPermissions): Promise<boolean>;
  request(permissions: OriginPermissions): Promise<boolean>;
};

// Read fresh each time rather than cached: the user can revoke a host from the
// browser's own extension settings at any moment.
export async function readGrantedAccessGroups(
    permissions: Pick<PermissionsApi, "contains">
): Promise<Set<AccessGroup>> {
  const groups = Object.keys(ACCESS_GROUP_ORIGINS) as AccessGroup[];
  const verdicts = await Promise.all(
      groups.map((group) => permissions.contains({ origins: [...ACCESS_GROUP_ORIGINS[group]] }))
  );
  return new Set(groups.filter((_, index) => verdicts[index]));
}

// The one request the popup may not live to see answered — see
// toggleWithAccess and toggleToCompleteAfterGrant.
export type PendingAccessRequest = { toggle: AccessToggle; requestedAt: string };
export const PENDING_ACCESS_REQUEST_KEY = "pendingAccessRequest";
// A grant this long after the request is no longer taken as its answer: a
// prompt is answered within moments, and an older request is more likely one
// denied while the popup was closing, which a grant made some other way (e.g.
// Firefox's add-on settings) must not revive.
export const PENDING_ACCESS_REQUEST_TTL_MS = 2 * 60 * 1000;

// Toggles switched on together with another once its access is granted —
// the wheel needs IndieGala's hosts anyway, and most users would never find
// and enable it on their own. The popup's IndieGala handler does the same.
export const TOGGLES_ENABLED_WITH: Partial<Record<AccessToggle, readonly AccessToggle[]>> = {
  indieGalaCheck: ["indieGalaWheelCheck"],
};

// Must be called synchronously, first thing, from the checkbox's change
// handler: Firefox only prompts for a request made inside the user gesture,
// i.e. before anything awaits. The flag is set only once access is granted:
// set ahead of the answer, a denied request would leave it on, and it would
// silently take effect the next time the same hosts are granted for another
// feature. Firefox may close the popup when its prompt appears, so the
// promise can go unanswered — the request is remembered for the background to
// finish (see toggleToCompleteAfterGrant). Turning a toggle off only clears
// its flag: groups are shared (GOG and GOG-linked Prime offers), so removing
// one could break another feature.
export function toggleWithAccess(
    toggle: AccessToggle,
    checked: boolean,
    setFlag: (value: boolean) => void,
    permissions: Pick<PermissionsApi, "request">,
    rememberRequest: (request: PendingAccessRequest | null) => void
): void {
  if (!checked) {
    setFlag(false);
    return;
  }

  let request: Promise<boolean>;
  try {
    request = permissions.request({ origins: requestOrigins(toggle) });
  } catch (e) {
    request = Promise.reject(e);
  }
  rememberRequest({ toggle, requestedAt: new Date().toISOString() });
  request.then(
      (isGranted) => {
        if (isGranted) setFlag(true);
        rememberRequest(null);
      },
      (e) => {
        console.error(`Requesting host access for ${toggle} failed:`, e);
        rememberRequest(null);
      }
  );
}

function isAccessToggle(value: unknown): value is AccessToggle {
  return typeof value === "string" && Object.hasOwn(TOGGLE_ACCESS_GROUPS, value);
}

// For the background's permissions.onAdded: the toggle whose remembered
// request this grant answered, if its hosts are now all granted. A newer
// request replaces the remembered one, so a denied request can't be revived
// by a later grant made for a different toggle.
export function toggleToCompleteAfterGrant(
    pending: unknown,
    granted: ReadonlySet<AccessGroup>,
    now: Date,
    ttlMs = PENDING_ACCESS_REQUEST_TTL_MS
): AccessToggle | null {
  if (typeof pending !== "object" || pending === null) return null;
  const { toggle, requestedAt } = pending as Record<string, unknown>;
  if (!isAccessToggle(toggle) || typeof requestedAt !== "string") return null;
  const ageMs = now.getTime() - new Date(requestedAt).getTime();
  if (!(ageMs >= 0 && ageMs <= ttlMs)) return null;
  return hasAccessFor(toggle, granted) ? toggle : null;
}

type ManifestPermissions = {
  host_permissions?: string[];
  optional_host_permissions?: string[];
  optional_permissions?: string[];
};

// For WXT's build:manifestGenerated hook. WXT adds each runtime content
// script's matches to host_permissions; those and every group origin come out,
// and the group origins are declared optional instead. The hook runs before
// WXT converts the manifest to MV2, a step that drops optional_host_permissions,
// so MV2 (Firefox) gets them in optional_permissions directly.
export function withOptionalHostAccess(
    manifest: Readonly<ManifestPermissions>,
    manifestVersion: 2 | 3,
    runtimeMatches: readonly string[]
): ManifestPermissions {
  const removed = new Set([...OPTIONAL_ORIGINS, ...runtimeMatches]);
  const hostPermissions = (manifest.host_permissions ?? []).filter((host) => !removed.has(host));
  const optionalKey = manifestVersion === 3 ? "optional_host_permissions" : "optional_permissions";
  return {
    host_permissions: hostPermissions,
    [optionalKey]: [...new Set([...(manifest[optionalKey] ?? []), ...OPTIONAL_ORIGINS])],
  };
}
