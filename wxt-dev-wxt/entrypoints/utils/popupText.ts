import { FreeGame } from "@/entrypoints/types/freeGame.ts";
import { parseGameDate } from "@/entrypoints/utils/gameDates.ts";
import { formatLocale, MessageKey, t, tPlural } from "@/entrypoints/utils/i18n.ts";
import { HealthError, HealthProblem } from "@/entrypoints/utils/health.ts";
import { PendingRedemption } from "@/entrypoints/utils/pendingRedemptions.ts";

// Short copy the popup builds from stored data, kept here so it can be tested.

export function claimedCountLabel(count: number): string {
    return tPlural("headerClaimedCount", count);
}

// "Prime Gaming → GOG" for a Prime offer that goes to another store.
export function platformLabel(game: FreeGame): string {
    return game.store ? `${game.platform} → ${game.store}` : game.platform;
}

function shortDate(date: Date, now: Date, locale: string): string {
    const isOtherYear = date.getFullYear() !== now.getFullYear();
    return date.toLocaleDateString(locale, {
        month: "short",
        day: "numeric",
        ...(isOtherYear ? { year: "numeric" } : {}),
    });
}

/**
 * "Free until Nov 13" for a current giveaway, "Nov 13 – Nov 20" (or "From
 * Nov 13") for an upcoming one, or null when the store gave no usable date.
 */
export function gameDateLabel(game: FreeGame, now: Date = new Date(), locale: string = formatLocale()): string | null {
    const start = parseGameDate(game.startDate);
    const end = parseGameDate(game.endDate);
    if (game.future) {
        if (!start) return null;
        return end
            ? t("gameDateRange", [shortDate(start, now, locale), shortDate(end, now, locale)])
            : t("gameFreeFrom", shortDate(start, now, locale));
    }
    return end ? t("gameFreeUntil", shortDate(end, now, locale)) : null;
}

const HEALTH_LABEL_KEYS: Record<HealthProblem, MessageKey> = {
    network: "healthNetwork",
    changed: "healthChanged",
    captcha: "healthCaptcha",
    unfinished: "healthUnfinished",
};

// A store warning's short name: "Can't reach store", "Store changed", ...
export function healthLabel(problem: HealthProblem): string {
    return t(HEALTH_LABEL_KEYS[problem]);
}

/**
 * A store warning's tooltip: what went wrong, then when. A claim tab's
 * explanation is stored as a key and translated here; a check's diagnostic
 * stays as it was. With neither (a stored key a later release renamed
 * resolves to ""), the warning's own name stands in, so the tooltip never
 * reads " (11/14/2026, ...)".
 */
export function healthTooltip(error: HealthError, locale: string = formatLocale()): string {
    const detail = (error.detailKey && t(error.detailKey)) || error.detail || healthLabel(error.problem);
    const time = new Date(error.at).toLocaleString(locale);
    return t(error.problem === "changed" ? "healthChangedTooltip" : "healthTooltip", [detail, time]);
}

// Why a code is still pending: its stored key, translated, or the English
// text earlier versions stored. Undefined when neither gives any text.
export function pendingReasonText(entry: PendingRedemption): string | undefined {
    return (entry.reasonKey && t(entry.reasonKey)) || entry.reason || undefined;
}
