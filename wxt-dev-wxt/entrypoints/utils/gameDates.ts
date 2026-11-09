import { FreeGame } from "@/entrypoints/types/freeGame.ts";

// A real date, or null: Epic writes new Date(0) when a promotion has no end.
export function parseGameDate(value: string | undefined): Date | null {
    if (!value) return null;
    const date = new Date(value);
    return Number.isFinite(date.getTime()) && date.getTime() > 0 ? date : null;
}

// Over once its end date has passed. A game without a usable end date (Steam,
// GOG and IndieGala give none) is never over by date: its store's next check
// is what drops it.
export function hasEnded(game: FreeGame, now: Date): boolean {
    const end = parseGameDate(game.endDate);
    return end !== null && end.getTime() <= now.getTime();
}

// What the popup lists. A stored list can outlive its giveaways: Prime Gaming's
// is only rewritten by a lookup that finds a Prime account, and every list sits
// unchanged between checks, while Epic's games end on the hour.
export function withoutEnded(games: readonly FreeGame[], now: Date = new Date()): FreeGame[] {
    return games.filter((game) => !hasEnded(game, now));
}
