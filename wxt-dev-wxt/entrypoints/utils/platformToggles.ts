import {Platforms} from "@/entrypoints/enums/platforms.ts";
import {AccessToggle} from "@/entrypoints/utils/optionalAccess.ts";

// The toggle whose optional hosts each platform's own check needs (see
// optionalAccess.ts); Steam and Epic use only required hosts.
export const PLATFORM_ACCESS_TOGGLES: Partial<Record<Platforms, AccessToggle>> = {
  [Platforms.GOG]: "gogCheck",
  [Platforms.IndieGala]: "indieGalaCheck",
  [Platforms.PrimeGaming]: "primeGamingCheck",
};

// Steam and Epic default ON; GOG, IndieGala and Prime Gaming default OFF on a
// fresh install (they need optional host access, and GOG defaulting on meant
// granting gog.com for GOG-linked Prime offers also switched on GOG giveaway
// claiming) — so an unset ("never stored") value must resolve opposite ways
// for the two groups. This is a pure, testable extraction of that asymmetry:
// getStorageItems returns raw storage, not the useStorage hook's own
// defaultValue, and the popup's default only lands in storage once the popup
// has actually been opened — this alarm-driven (and install-time) path can
// run first.
//
// Steam/Epic are included too even though they default ON: passing
// a raw `null` straight into getEpicGamesList(shouldClaim: boolean = true)
// does NOT fall back to the default — JS default parameters only trigger for
// `undefined`, and getStorageItems resolves an unset key to `null`. Without
// resolving it here first, the very first (install-time) run silently never
// claims or detects login state for Steam/Epic on a fresh install.
export function resolvePlatformToggles(flags: {
  steamCheck?: boolean | null;
  epicCheck?: boolean | null;
  gogCheck?: boolean | null;
  indieGalaCheck?: boolean | null;
  primeGamingCheck?: boolean | null;
}): {
  claimSteam: boolean;
  claimEpic: boolean;
  claimGog: boolean;
  claimIndieGala: boolean;
  claimPrimeGaming: boolean;
} {
  return {
    claimSteam: flags.steamCheck !== false,
    claimEpic: flags.epicCheck !== false,
    claimGog: flags.gogCheck === true,
    claimIndieGala: flags.indieGalaCheck === true,
    claimPrimeGaming: flags.primeGamingCheck === true,
  };
}
