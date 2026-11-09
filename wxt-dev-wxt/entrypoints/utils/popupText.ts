import { FreeGame } from "@/entrypoints/types/freeGame.ts";
import { parseGameDate } from "@/entrypoints/utils/gameDates.ts";

// Short copy the popup builds from stored data, kept here so it can be tested.

export function claimedCountLabel(count: number): string {
    return `${count} ${count === 1 ? "game" : "games"} claimed`;
}

// "Prime Gaming → GOG" for a Prime offer that goes to another store.
export function platformLabel(game: FreeGame): string {
    return game.store ? `${game.platform} → ${game.store}` : game.platform;
}

function shortDate(date: Date, now: Date, locale: string | undefined): string {
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
export function gameDateLabel(game: FreeGame, now: Date = new Date(), locale?: string): string | null {
    const start = parseGameDate(game.startDate);
    const end = parseGameDate(game.endDate);
    if (game.future) {
        if (!start) return null;
        return end
            ? `${shortDate(start, now, locale)} – ${shortDate(end, now, locale)}`
            : `From ${shortDate(start, now, locale)}`;
    }
    return end ? `Free until ${shortDate(end, now, locale)}` : null;
}
