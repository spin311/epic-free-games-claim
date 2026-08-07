// Toolbar-button (badge) access that works on both build targets.
//
// The Chrome build is Manifest V3 and exposes `browser.action`; the Firefox
// build is Manifest V2 and exposes `browser.browserAction` instead — there is
// no `action` namespace at all. Touching `browser.action.setBadgeText` on
// Firefox therefore threw a TypeError, and because the popup did it during
// render, React tore the whole tree down and the popup opened as an empty,
// zero-height strip.

interface BadgeTextDetails {
    text: string;
}

interface BadgeColorDetails {
    color: string;
}

export interface ActionApi {
    setBadgeText(details: BadgeTextDetails): Promise<void> | void;
    setBadgeBackgroundColor(details: BadgeColorDetails): Promise<void> | void;
}

export interface ActionNamespaces {
    action?: ActionApi;
    browserAction?: ActionApi;
}

export function resolveActionApi(namespaces: ActionNamespaces): ActionApi | undefined {
    return namespaces.action ?? namespaces.browserAction;
}

// The badge is decoration: a browser that offers neither namespace must not be
// able to break a claim run or blank the popup, so we warn and carry on.
function getActionApi(): ActionApi | undefined {
    const api = resolveActionApi(browser as unknown as ActionNamespaces);
    if (!api) {
        console.warn("[badge] no action/browserAction namespace available; skipping badge update");
    }
    return api;
}

export async function setBadgeText(text: string): Promise<void> {
    await getActionApi()?.setBadgeText({ text });
}

export async function setBadgeBackgroundColor(color: string): Promise<void> {
    await getActionApi()?.setBadgeBackgroundColor({ color });
}
