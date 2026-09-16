import { Platforms } from "@/entrypoints/enums/platforms.ts";
import { setStorageItem } from "@/entrypoints/hooks/useStorage.ts";
import { wait } from "@/entrypoints/utils/helpers.ts";

// `null` means "the page gave us no usable signal" — it is NOT "logged out".
// Keeping the two apart is the whole point of this module: a failed read must
// leave the last known state alone instead of falsely reporting a signed-out
// account (and the popup shows no badge at all until something is known).
export type LoginState = boolean | null;

export const LOGIN_STATE_KEYS: Record<Platforms, string> = {
    [Platforms.Epic]: "epicLoggedIn",
    [Platforms.Steam]: "steamLoggedIn",
    [Platforms.GOG]: "gogLoggedIn",
    [Platforms.IndieGala]: "indieGalaLoggedIn",
    [Platforms.PrimeGaming]: "primeGamingLoggedIn",
};

const POLL_INTERVAL_MS = 250;
const DETECT_TIMEOUT_MS = 5_000;

// Epic renders its header as an <egs-navigation> web component and only sets
// `isloggedin` once that component hydrates, so the element's presence alone
// proves nothing — the attribute has to exist before we can read a state.
export function readEpicLoginState(doc: Document): LoginState {
    const attribute = doc.querySelector('egs-navigation')?.getAttribute('isloggedin');
    if (attribute == null) return null;
    return attribute === 'true';
}

// Steam's header is server-rendered: #global_actions is on every store page,
// and #account_pulldown sits inside it only for a signed-in session. So a
// missing container means we aren't looking at a rendered store header yet
// (or the markup changed) rather than a signed-out user.
export function readSteamLoginState(doc: Document): LoginState {
    const actions = doc.querySelector('#global_actions');
    if (!actions) return null;
    return !!actions.querySelector('#account_pulldown');
}

// The header container is present on every page; when signed out it wraps a
// child .header-top-notlogged element (confirmed live, unauthenticated). Only
// that known signed-out signal is checked, so this doesn't depend on knowing
// what the signed-in markup looks like.
export function readIndieGalaLoginState(doc: Document): LoginState {
    const userCont = doc.querySelector('.header-top-user');
    if (!userCont) return null;
    return !userCont.querySelector('.header-top-notlogged');
}

// GOG is deliberately absent: its session is proven by /giveaway/status
// answering 401 or not, so the GOG content script calls recordLoginState
// directly instead of reading the DOM. Returning null here keeps
// detectAndRecordLoginState a no-op for GOG rather than silently applying
// Steam's selectors to a gog.com page.
export function readLoginState(platform: Platforms, doc: Document): LoginState {
    switch (platform) {
        case Platforms.Epic:
            return readEpicLoginState(doc);
        case Platforms.Steam:
            return readSteamLoginState(doc);
        case Platforms.IndieGala:
            return readIndieGalaLoginState(doc);
        default:
            return null;
    }
}

// Both signals depend on rendering we don't control, so poll briefly rather
// than taking a single post-DOMContentLoaded snapshot.
export async function detectLoginState(
    platform: Platforms,
    doc: Document = document,
    timeoutMs: number = DETECT_TIMEOUT_MS
): Promise<LoginState> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
        const state = readLoginState(platform, doc);
        if (state !== null) return state;
        if (Date.now() >= deadline) return null;
        await wait(POLL_INTERVAL_MS);
    }
}

export async function recordLoginState(platform: Platforms, state: LoginState): Promise<void> {
    if (state === null) return;
    await setStorageItem(LOGIN_STATE_KEYS[platform], state);
}

// Fire-and-forget from the content scripts: detection must never delay or fail
// a claim, so errors are logged and swallowed rather than propagated.
export async function detectAndRecordLoginState(
    platform: Platforms,
    doc: Document = document
): Promise<LoginState> {
    try {
        const state = await detectLoginState(platform, doc);
        await recordLoginState(platform, state);
        return state;
    } catch (error: unknown) {
        console.error(`[loginState] ${platform} detection failed:`, error);
        return null;
    }
}
