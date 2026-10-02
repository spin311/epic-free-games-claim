import { findButtonByText } from "@/entrypoints/utils/helpers.ts";

// Shared by gog.content.ts and microsoft.content.ts: both land on a real
// redeem page (via primegaming.content.ts navigating a Prime-linked claim tab
// there) and need to fill in a code and submit a form built by someone else's
// SPA. Kept generic/injectable rather than page-specific so the same logic —
// and its tests — cover both.

// React (and some Vue) forms track their own copy of an input's value via the
// framework's synthetic event wrapper, which overrides the native `value`
// setter on the element instance. Assigning `.value` directly bypasses that
// wrapper, so the framework never sees the change. Going through the
// prototype's original setter, then firing a real 'input' event, is the
// standard workaround and is harmless for plain (non-framework) inputs too.
export function setControlledInputValue(input: HTMLInputElement, value: string): void {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
    setter?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
}

// Redeem pages don't expose a stable id/name we can rely on across two
// different companies' sites, so this matches on whatever hint text shows up
// across the attributes a real label is likely to live in.
export function findInputByHint(root: Document | HTMLElement, hint: RegExp): HTMLInputElement | null {
    const inputs = Array.from(root.querySelectorAll<HTMLInputElement>('input'));
    return inputs.find((el) => {
        const haystack = [el.id, el.name, el.getAttribute('aria-label') ?? '', el.placeholder].join(' ');
        return hint.test(haystack);
    }) ?? null;
}

// Tries each candidate label in order and returns the first match — the exact
// wording ("Next" vs "Redeem" vs "Continue") isn't confirmed for every site,
// so this covers the plausible set rather than betting on one string.
export function findButtonByAnyText(root: Document | HTMLElement, texts: string[]): HTMLButtonElement | null {
    for (const text of texts) {
        const button = findButtonByText(root, text);
        if (button) return button;
    }
    return null;
}

function isClickable(button: HTMLButtonElement): boolean {
    return !button.disabled && button.getAttribute('aria-disabled') !== 'true';
}

export type RedeemOutcome = "redeemed" | "not-redeemed";

// Confirmed live against both real sites that a URL/route change is NOT a
// usable success signal: Microsoft's redeem flow is multi-step (enter code ->
// Next -> a *different* URL for a Confirm step -> a *third* URL only once
// actually redeemed), so treating the first URL change as done fires too
// early. GOG's is worse — its SPA moves to a new URL (the code becomes part
// of the path) even when the code was already used and redemption FAILED, so
// URL change there doesn't even correlate with success/failure.
//
// So this fills the code in, then repeatedly clicks whatever submit-like
// button shows up (never the same button twice, so a button that's
// enabled but genuinely stuck — bad code, unresolved captcha, terms
// checkbox — gets exactly one click rather than being hammered; "same" means
// same element AND same label, since GOG's Vue form patches its "Continue"
// <button> in place into the next step's "Redeem"; capped at
// MAX_SUBMIT_CLICKS so a button that keeps flipping labels can't be submitted
// over and over), and reports the button disappearing for a settled stretch
// (not just a one-tick gap between two steps' renders) as "redeemed". That is
// only a candidate signal: confirmed live on GOG, the button can vanish
// without anything being redeemed, so callers that can check positively
// (gog.content.ts — see waitForRedeemConfirmation) must do so. This covers
// a single-step flow and a multi-step one (GOG's Continue -> Redeem,
// Microsoft's Next -> Confirm) without needing to know in advance which shape
// a given site uses.
// Real flows need 2 (GOG: Continue -> Redeem; Microsoft: Next -> Confirm).
const MAX_SUBMIT_CLICKS = 4;

export async function submitRedeemCode(
    code: string,
    input: HTMLInputElement,
    findSubmitButton: () => HTMLButtonElement | null,
    setInputValue: (input: HTMLInputElement, value: string) => void,
    clickFn: (el: HTMLElement) => void,
    waitFn: (ms: number) => Promise<void>,
    timeoutMs = 20000,
    pollIntervalMs = 250,
    settleMs = 1000,
): Promise<RedeemOutcome> {
    setInputValue(input, code);

    let lastClicked: HTMLButtonElement | null = null;
    let lastClickedLabel = '';
    let clickCount = 0;
    let noButtonSince: number | null = null;
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
        const button = findSubmitButton();
        if (button) {
            noButtonSince = null;
            const label = (button.textContent ?? '').trim();
            const isNewStep = button !== lastClicked || label !== lastClickedLabel;
            if (isNewStep && isClickable(button) && clickCount < MAX_SUBMIT_CLICKS) {
                clickFn(button);
                lastClicked = button;
                lastClickedLabel = label;
                clickCount++;
            }
        } else if (clickCount > 0) {
            noButtonSince ??= Date.now();
            if (Date.now() - noButtonSince >= settleMs) return "redeemed";
        }
        await waitFn(pollIntervalMs);
    }
    return "not-redeemed";
}

// Our own markers, not a feature either redeem page actually implements —
// primegaming.content.ts appends them before navigating so the destination's
// content script (gog.content.ts / microsoft.content.ts) can read the code
// (and, best-effort, the game's title — used only for the pending-redemption
// fallback UI, never required) back out after the cross-origin navigation
// completes.
export const REDEEM_CODE_PARAM = "extCode";
export const REDEEM_TITLE_PARAM = "extTitle";

export function extractRedeemCodeParam(search: string): string | null {
    return new URLSearchParams(search).get(REDEEM_CODE_PARAM);
}

export function extractRedeemTitleParam(search: string): string | null {
    return new URLSearchParams(search).get(REDEEM_TITLE_PARAM);
}

// Shared by buildRedeemUrl (GOG) and buildMicrosoftRedeemUrl so both destinations
// use the exact same param names — never duplicated ad hoc per site.
export function appendRedeemParams(baseUrl: string, code: string, title?: string): string {
    const url = new URL(baseUrl);
    url.searchParams.set(REDEEM_CODE_PARAM, code);
    if (title) url.searchParams.set(REDEEM_TITLE_PARAM, title);
    return url.toString();
}
