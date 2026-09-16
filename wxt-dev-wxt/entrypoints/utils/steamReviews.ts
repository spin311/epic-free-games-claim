// Optional Steam quality gate: when the user sets a minimum positive-review
// percentage, a free Steam game is only claimed if it clears that bar.
//
// WHICH percentage, because a store page shows several that disagree. For
// app 674750 the page carries all of these at once:
//
//   68% of 22        recent reviews (last 30 days)
//   82% of 550       the viewer's language only
//   84% of 2,555     ALL languages, off-topic review activity excluded  ← the gate
//   82.2% of 3,484   the appreviews API (all languages AND all purchase types)
//
// The gate uses the all-languages lifetime score, because that is Steam's
// headline number and the one a user comparing games actually sees. It is only
// on the page, so the page is the primary source and the API is the fallback
// for when the page can't be parsed (age-gate interstitial, markup change).
import { parse } from 'node-html-parser';

export type SteamReviewSummary = {
    total_positive?: number;
    total_negative?: number;
    total_reviews?: number;
} | null | undefined;

export interface ReviewTier {
    // The minimum positive percentage this preset requires.
    threshold: number;
    // Steam's name for the rating band that CONTAINS that percentage. Several
    // presets can share a label — 40/50/60 all sit inside "Mixed" (40-69%) —
    // which is fine because the threshold, not the label, identifies a preset.
    label: string;
}

// Selectable presets, strictest first. Thresholds are unique, so the number
// alone keys the dropdown.
export const STEAM_REVIEW_TIERS: readonly ReviewTier[] = [
    { threshold: 90, label: 'Very Positive' },
    { threshold: 80, label: 'Very Positive' },
    { threshold: 70, label: 'Mostly Positive' },
    { threshold: 60, label: 'Mixed' },
    { threshold: 50, label: 'Mixed' },
    { threshold: 40, label: 'Mixed' },
    { threshold: 20, label: 'Mostly Negative' },
] as const;

const MIN_PERCENT = 0;
const MAX_PERCENT = 100;

// Blank when the number isn't one of the presets (a hand-typed value), which
// the UI surfaces as "Custom" rather than silently showing "Any".
export function findTierLabelForThreshold(threshold: number | null): string {
    if (threshold === null) return '';
    return STEAM_REVIEW_TIERS.find((tier) => tier.threshold === threshold)?.label ?? '';
}

export function parseSteamAppId(url: string): number | null {
    const match = /\/app\/(\d+)/.exec(url);
    return match ? Number(match[1]) : null;
}

// A blank or unparseable field means "no threshold" — the gate stays off.
export function parseThresholdInput(raw: string): number | null {
    if (raw.trim() === '') return null;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) return null;
    return Math.min(MAX_PERCENT, Math.max(MIN_PERCENT, parsed));
}

// `null` means "no percentage exists" (a reviewless game), which is NOT 0%.
export function calculatePositivePercent(summary: SteamReviewSummary): number | null {
    const total = summary?.total_reviews ?? 0;
    const positive = summary?.total_positive ?? 0;
    if (!Number.isFinite(total) || total <= 0) return null;
    return (positive / total) * 100;
}

export function meetsPositiveThreshold(percent: number | null, threshold: number | null): boolean {
    if (threshold === null) return true;   // gate off
    if (percent === null) return false;    // confirmed reviewless → cannot clear the bar
    return percent >= threshold;
}

// Both selectors and the leading digits are locale-independent; the surrounding
// tooltip prose ("...for this game are positive") is localized and deliberately
// not matched on.
function firstPercentIn(tooltip: string | undefined): number | null {
    const match = /(\d{1,3})\s*%/.exec(tooltip ?? '');
    if (!match) return null;
    const percent = Number(match[1]);
    return percent >= MIN_PERCENT && percent <= MAX_PERCENT ? percent : null;
}

// Reads the all-languages lifetime score out of a store app page.
export function parsePagePositivePercent(html: string): number | null {
    if (!html) return null;
    const root = parse(html);

    // Multi-language games carry an explicit "Total reviews in all languages"
    // box; its tooltip holds the figure the gate wants.
    const total = root.querySelector('.outlier_totals.global .game_review_summary');
    const fromTotal = firstPercentIn(total?.getAttribute('data-tooltip-html'));
    if (fromTotal !== null) return fromTotal;

    // Without that box there is no per-language split, so the single "All
    // Reviews" row (marked `.all`, as opposed to the unmarked recent row) already
    // IS the all-languages figure.
    const allRow = root.querySelector('.user_reviews_summary_row:has(.subtitle.all)')
        ?? root.querySelectorAll('.user_reviews_summary_row')
            .find((row) => !!row.querySelector('.subtitle.all'));
    return firstPercentIn(allRow?.getAttribute('data-tooltip-html'));
}

function appPageUrl(appId: number): string {
    return `https://store.steampowered.com/app/${appId}/`;
}

// Throws on transport/protocol failure; resolves null when the page loaded but
// carried no parsable score.
export async function fetchPagePositivePercent(appId: number): Promise<number | null> {
    const response = await fetch(appPageUrl(appId));
    if (!response.ok) {
        throw new Error(`Steam app page HTTP ${response.status} for app ${appId}`);
    }
    return parsePagePositivePercent(await response.text());
}

// Page first, API second. Only a page problem falls through to the API; an API
// failure propagates, because at that point we have nothing left to try.
export async function resolvePositivePercent(appId: number): Promise<number | null> {
    try {
        const fromPage = await fetchPagePositivePercent(appId);
        if (fromPage !== null) return fromPage;
        console.warn(`[reviews] app ${appId}: no score on the store page — trying the API`);
    } catch (error: unknown) {
        console.warn(`[reviews] app ${appId}: store page unreadable — trying the API:`, error);
    }
    return fetchSteamPositivePercent(appId);
}

function appReviewsUrl(appId: number): string {
    return `https://store.steampowered.com/appreviews/${appId}` +
        `?json=1&language=all&purchase_type=all&num_per_page=0`;
}

// Throws on any transport/protocol failure, so callers can distinguish "Steam
// told us this game has no reviews" (resolves null) from "we couldn't ask".
export async function fetchSteamPositivePercent(appId: number): Promise<number | null> {
    const response = await fetch(appReviewsUrl(appId));
    if (!response.ok) {
        throw new Error(`Steam appreviews HTTP ${response.status} for app ${appId}`);
    }
    const data = await response.json();
    if (data?.success !== 1) {
        throw new Error(`Steam appreviews reported success=${data?.success} for app ${appId}`);
    }
    return calculatePositivePercent(data.query_summary);
}

// The claim/skip verdict for one Steam game.
//
// Fails OPEN on our own failures (unreadable link, network error, Steam
// outage): free promos are time-limited, so a lookup we couldn't perform must
// not cost the user a game. Fails CLOSED only on a verdict Steam actually
// gave us — a confirmed 0-review game cannot clear a bar the user set.
export async function shouldClaimSteamGame(link: string, threshold: number | null): Promise<boolean> {
    if (threshold === null) return true;

    const appId = parseSteamAppId(link);
    if (appId === null) {
        console.warn(`[reviews] no appid in "${link}" — claiming without a review check`);
        return true;
    }

    try {
        const percent = await resolvePositivePercent(appId);
        const allowed = meetsPositiveThreshold(percent, threshold);
        const shown = percent === null ? 'no reviews' : `${percent.toFixed(1)}% positive`;
        console.log(`[reviews] app ${appId}: ${shown} vs ${threshold}% → ${allowed ? 'claim' : 'skip'}`);
        return allowed;
    } catch (error: unknown) {
        console.error(`[reviews] lookup failed for app ${appId} — claiming anyway:`, error);
        return true;
    }
}
