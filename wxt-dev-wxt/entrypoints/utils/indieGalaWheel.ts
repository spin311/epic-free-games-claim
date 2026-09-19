import { findButtonByText } from "@/entrypoints/utils/helpers.ts";

// The "Wheel of Fortune" daily-spin widget lives on the IndieGala homepage,
// not on freebies.indiegala.com — a separate mechanic (galasilver/coupons,
// not games) from the freebie claiming in indieGalaGiveaway.ts.
export const INDIEGALA_WHEEL_URL = "https://www.indiegala.com/";

// The page only injects the wheel widget (built from a <template> by the
// site's own script) when the signed-in user has a spin available today, so
// the Spin button's mere presence *is* the availability signal — no separate
// status check needed. Matched by visible text, like Epic's confirm buttons,
// since the widget's classes are the site's own and not a contract we own.
export function findSpinButton(root: Document | HTMLElement): HTMLButtonElement | null {
    return findButtonByText(root, "Spin");
}

export type WheelPrize = {
    label: string;
    text: string;
};

// What's actually persisted to storage (indieGalaWheelLastPrize) — the parsed
// prize plus when it was won, so the popup can show a dated line.
export type StoredWheelPrize = WheelPrize & { wonAt: string };

// The prize was already decided server-side before Spin was ever clicked —
// the page's own script fills these two nodes in as soon as the (purely
// cosmetic) spin animation finishes, so reading them back is the reliable
// way to learn what was won without reimplementing the site's redeem call.
export function parseWheelPrize(root: Document | HTMLElement): WheelPrize | null {
    const results = root.querySelector(".fortune-wheel-results");
    if (!results) return null;

    const label = results.querySelector("h4 span:last-child")?.textContent?.trim() ?? "";
    if (!label) return null;

    const text = results.querySelector("p")?.textContent?.trim() ?? "";
    return { label, text };
}
