import { describe, it, expect, vi } from 'vitest';
import type { Browser } from 'wxt/browser';
import { ACCESS_GROUP_ORIGINS, AccessGroup } from './optionalAccess';
import {
  contentScriptRegistration,
  planContentScriptSync,
  RUNTIME_CONTENT_SCRIPT_MATCHES,
  RUNTIME_CONTENT_SCRIPTS,
  runtimeContentScriptOptions,
  RuntimeScriptId,
  syncRuntimeContentScripts,
} from './runtimeContentScripts';

type Registered = Browser.scripting.RegisteredContentScript;

// In-memory stand-in for browser.scripting's dynamic registration calls.
function fakeScripting(initial: Registered[] = []) {
  let registered = [...initial];
  return {
    getRegisteredContentScripts: vi.fn(async () => registered),
    registerContentScripts: vi.fn(async (scripts: Registered[]) => {
      registered = [...registered, ...scripts];
    }),
    unregisterContentScripts: vi.fn(async ({ ids }: { ids?: string[] } = {}) => {
      registered = registered.filter((script) => !ids?.includes(script.id));
    }),
    ids: () => registered.map((script) => script.id).sort(),
  };
}

describe('RUNTIME_CONTENT_SCRIPTS', () => {
  // A registered script only injects where the extension has host access, so
  // each one's matches must sit inside the origins its group requests.
  it('only matches pages its own access group covers', () => {
    for (const script of Object.values(RUNTIME_CONTENT_SCRIPTS)) {
      const origins = ACCESS_GROUP_ORIGINS[script.group];
      for (const match of script.matches) {
        const isCovered = origins.some((origin) => match.startsWith(origin.replace(/\*$/, '')));
        expect(isCovered, `${match} is outside the ${script.group} group`).toBe(true);
      }
    }
  });

  it('lists every runtime match pattern for the manifest hook', () => {
    expect(RUNTIME_CONTENT_SCRIPT_MATCHES).toContain('https://account.microsoft.com/billing/redeem*');
    expect(RUNTIME_CONTENT_SCRIPT_MATCHES).toContain('https://www.gog.com/*');
  });
});

describe('runtimeContentScriptOptions', () => {
  // A static manifest entry's matches would count as install-time host access.
  it('keeps the script out of the manifest, with the same options the background registers', () => {
    expect(runtimeContentScriptOptions('legacygames')).toEqual({
      matches: RUNTIME_CONTENT_SCRIPTS.legacygames.matches,
      runAt: 'document_idle',
      allFrames: false,
      registration: 'runtime',
    });
  });
});

describe('contentScriptRegistration', () => {
  it('points at the bundle WXT emits for that entrypoint and does not persist', () => {
    expect(contentScriptRegistration('microsoft')).toEqual({
      id: 'microsoft',
      js: ['content-scripts/microsoft.js'],
      matches: RUNTIME_CONTENT_SCRIPTS.microsoft.matches,
      runAt: 'document_idle',
      allFrames: true,
      persistAcrossSessions: false,
    });
  });
});

describe('planContentScriptSync', () => {
  const idsOf = (scripts: { id: string }[]) => scripts.map((script) => script.id).sort();

  it('registers the scripts of newly granted groups', () => {
    const plan = planContentScriptSync(new Set<AccessGroup>(['indieGala', 'microsoft']), []);

    expect(plan.unregister).toEqual([]);
    expect(idsOf(plan.register)).toEqual(['indiegala', 'indiegalaWheel', 'microsoft']);
  });

  it('unregisters the scripts of groups no longer granted', () => {
    const registered = [contentScriptRegistration('gog'), contentScriptRegistration('primegaming')];

    const plan = planContentScriptSync(new Set<AccessGroup>(['gog']), registered);

    expect(plan.unregister).toEqual(['primegaming']);
    expect(plan.register).toEqual([]);
  });

  it('changes nothing when the registrations already match', () => {
    // Browsers report defaults back explicitly and may echo js with a leading slash.
    const registered = [{ ...contentScriptRegistration('gog'), js: ['/content-scripts/gog.js'], world: 'ISOLATED' as const }];

    expect(planContentScriptSync(new Set<AccessGroup>(['gog']), registered)).toEqual({ unregister: [], register: [] });
  });

  // e.g. an update widened a script's matches: the stale registration from
  // before would otherwise keep injecting with the old patterns.
  it('re-registers a script whose registered config differs from the current one', () => {
    const stale = { ...contentScriptRegistration('gog'), matches: ['https://www.gog.com/en/*'] };

    const plan = planContentScriptSync(new Set<AccessGroup>(['gog']), [stale]);

    expect(plan.unregister).toEqual(['gog']);
    expect(plan.register).toEqual([contentScriptRegistration('gog')]);
  });

  it('leaves registrations it does not own alone', () => {
    const foreign = { id: 'wxt-dev-reload', js: ['x.js'], matches: ['<all_urls>'] };

    expect(planContentScriptSync(new Set<AccessGroup>(), [foreign])).toEqual({ unregister: [], register: [] });
  });
});

describe('syncRuntimeContentScripts', () => {
  it('brings the registrations in line with the granted groups', async () => {
    const scripting = fakeScripting([contentScriptRegistration('legacygames')]);

    await syncRuntimeContentScripts(scripting, new Set<AccessGroup>(['gog', 'primeGaming']));

    expect(scripting.ids()).toEqual(['gog', 'primegaming']);
  });

  it('is idempotent: a second sync with the same access makes no calls', async () => {
    const scripting = fakeScripting();
    const granted = new Set<AccessGroup>(['gog']);

    await syncRuntimeContentScripts(scripting, granted);
    await syncRuntimeContentScripts(scripting, granted);

    expect(scripting.registerContentScripts).toHaveBeenCalledTimes(1);
    expect(scripting.unregisterContentScripts).not.toHaveBeenCalled();
  });

  it('unregisters a changed script before registering it again, so its id is free', async () => {
    const scripting = fakeScripting([{ ...contentScriptRegistration('gog'), matches: ['https://www.gog.com/en/*'] }]);

    await syncRuntimeContentScripts(scripting, new Set<AccessGroup>(['gog']));

    expect(scripting.unregisterContentScripts.mock.invocationCallOrder[0])
        .toBeLessThan(scripting.registerContentScripts.mock.invocationCallOrder[0]);
    expect(await scripting.getRegisteredContentScripts()).toEqual([contentScriptRegistration('gog')]);
  });

  it('covers every runtime script id', () => {
    const ids: RuntimeScriptId[] = ['gog', 'indiegala', 'indiegalaWheel', 'primegaming', 'microsoft', 'legacygames'];
    expect(Object.keys(RUNTIME_CONTENT_SCRIPTS).sort()).toEqual([...ids].sort());
  });
});
