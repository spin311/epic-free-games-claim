import type { Browser } from "wxt/browser";
// Relative, from a module with no runtime imports of its own: wxt.config.ts
// imports this one outside Vite (see optionalAccess.ts), so it can't use the
// `@/` alias or pull in `browser`.
import { ACCESS_GROUP_ORIGINS, type AccessGroup } from "./optionalAccess.ts";

// The content scripts for optional hosts are `registration: "runtime"`: a
// static manifest entry's matches count as install-time host permissions. The
// background registers each one while its group is granted (see
// syncRuntimeContentScripts). Both defineContentScript and that registration
// read from here, so the two can't drift apart.

type RegisteredContentScript = Browser.scripting.RegisteredContentScript;

export type RuntimeScriptId = "gog" | "indiegala" | "indiegalaWheel" | "primegaming" | "microsoft" | "legacygames";

export type RuntimeContentScript = {
  group: AccessGroup;
  matches: string[];
  // Pages added to the script while another, optional group is granted too.
  extraMatches?: readonly { group: AccessGroup; matches: string[] }[];
  runAt: Browser.extensionTypes.RunAt;
  allFrames: boolean;
};

// Keyed by entrypoint name (<id>.content.ts), which is also the bundle's name.
export const RUNTIME_CONTENT_SCRIPTS: Readonly<Record<RuntimeScriptId, RuntimeContentScript>> = {
  gog: { group: "gog", matches: ["https://www.gog.com/*"], runAt: "document_idle", allFrames: false },
  indiegala: { group: "indieGala", matches: ["https://freebies.indiegala.com/*"], runAt: "document_idle", allFrames: false },
  indiegalaWheel: { group: "indieGala", matches: ["https://www.indiegala.com/*"], runAt: "document_idle", allFrames: false },
  // gaming.amazon.com/home now redirects to luna.amazon.com/claims/home — the
  // page that actually renders the offer list and per-game claim links lives
  // on luna.amazon.com, so both hosts must be matched for the script to ever
  // get injected.
  primegaming: {
    group: "primeGaming",
    matches: ["https://gaming.amazon.com/*", "https://luna.amazon.com/*"],
    // Where both redirect a visitor from a country with its own Luna site.
    extraMatches: [{ group: "lunaRegional", matches: [...ACCESS_GROUP_ORIGINS.lunaRegional] }],
    runAt: "document_idle",
    allFrames: false,
  },
  // The redeem form lives in a cross-origin iframe on www.microsoft.com inside
  // the account.microsoft.com page, hence allFrames.
  microsoft: {
    group: "microsoft",
    matches: ["https://account.microsoft.com/billing/redeem*", "https://www.microsoft.com/store/purchase/buynowui/*"],
    runAt: "document_idle",
    allFrames: true,
  },
  // A submission lands on the legacygames.com/amazon-luna-x-legacy-games-{game}/
  // page, an error back on the promo page — hence both patterns.
  legacygames: {
    group: "legacyGames",
    matches: ["https://promo.legacygames.com/*", "https://legacygames.com/amazon-luna-x-legacy-games-*"],
    runAt: "document_idle",
    allFrames: false,
  },
};

const RUNTIME_SCRIPT_IDS = Object.keys(RUNTIME_CONTENT_SCRIPTS) as RuntimeScriptId[];

// Every page a script can run on, whichever groups are granted.
function allMatches(id: RuntimeScriptId): string[] {
  const { matches, extraMatches = [] } = RUNTIME_CONTENT_SCRIPTS[id];
  return [...matches, ...extraMatches.flatMap((extra) => extra.matches)];
}

// The pages a script runs on with these groups granted.
function grantedMatches(id: RuntimeScriptId, granted: ReadonlySet<AccessGroup>): string[] {
  const { matches, extraMatches = [] } = RUNTIME_CONTENT_SCRIPTS[id];
  return [...matches, ...extraMatches.filter((extra) => granted.has(extra.group)).flatMap((extra) => extra.matches)];
}

export const RUNTIME_CONTENT_SCRIPT_MATCHES: readonly string[] = RUNTIME_SCRIPT_IDS.flatMap(allMatches);

export type RuntimeContentScriptOptions = {
  matches: string[];
  runAt: Browser.extensionTypes.RunAt;
  allFrames: boolean;
  registration: "runtime";
};

// Each runtime script's defineContentScript options. Destructured and listed
// there rather than spread: WXT's build-time option reader expects every
// option to be a named property and crashes on a spread element.
export function runtimeContentScriptOptions(id: RuntimeScriptId): RuntimeContentScriptOptions {
  const { runAt, allFrames } = RUNTIME_CONTENT_SCRIPTS[id];
  return { matches: allMatches(id), runAt, allFrames, registration: "runtime" };
}

// persistAcrossSessions: false because Firefox before 128 rejects true; the
// background re-syncs on every start, which covers browser restarts.
export function contentScriptRegistration(
    id: RuntimeScriptId,
    granted: ReadonlySet<AccessGroup> = new Set()
): RegisteredContentScript {
  const { runAt, allFrames } = RUNTIME_CONTENT_SCRIPTS[id];
  const matches = grantedMatches(id, granted);
  return { id, js: [`content-scripts/${id}.js`], matches, runAt, allFrames, persistAcrossSessions: false };
}

// Browsers echo registrations back with their defaults filled in (and may
// report js paths with a leading slash), so compare only what we set.
function registrationKey(script: RegisteredContentScript): string {
  return JSON.stringify({
    js: (script.js ?? []).map((path) => path.replace(/^\//, "")),
    matches: [...(script.matches ?? [])].sort(),
    runAt: script.runAt ?? "document_idle",
    allFrames: script.allFrames ?? false,
  });
}

export type ContentScriptSyncPlan = {
  unregister: RuntimeScriptId[];
  register: RegisteredContentScript[];
};

// Only our own ids are touched. A registration whose config changed (e.g. an
// update widened its matches) is unregistered and registered again.
export function planContentScriptSync(
    granted: ReadonlySet<AccessGroup>,
    registered: readonly RegisteredContentScript[]
): ContentScriptSyncPlan {
  const registeredById = new Map(registered.map((script) => [script.id, script]));
  const unregister: RuntimeScriptId[] = [];
  const register: RegisteredContentScript[] = [];

  for (const id of RUNTIME_SCRIPT_IDS) {
    const current = registeredById.get(id);
    const desired = granted.has(RUNTIME_CONTENT_SCRIPTS[id].group) ? contentScriptRegistration(id, granted) : null;
    const isUpToDate = current && desired && registrationKey(current) === registrationKey(desired);
    if (isUpToDate) continue;
    if (current) unregister.push(id);
    if (desired) register.push(desired);
  }
  return { unregister, register };
}

export type ScriptingApi = {
  getRegisteredContentScripts(): Promise<RegisteredContentScript[]>;
  registerContentScripts(scripts: RegisteredContentScript[]): Promise<void>;
  unregisterContentScripts(filter: { ids: string[] }): Promise<void>;
};

// Idempotent: a sync with nothing to change makes no register/unregister call.
// Unregisters first so a changed script's id is free to register again.
export async function syncRuntimeContentScripts(
    scripting: ScriptingApi,
    granted: ReadonlySet<AccessGroup>
): Promise<void> {
  const plan = planContentScriptSync(granted, await scripting.getRegisteredContentScripts());
  if (plan.unregister.length > 0) await scripting.unregisterContentScripts({ ids: plan.unregister });
  if (plan.register.length > 0) await scripting.registerContentScripts(plan.register);
}
