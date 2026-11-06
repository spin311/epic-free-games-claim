import {Platforms} from "@/entrypoints/enums/platforms.ts";

export type FreeGame = {
    title: string;
    platform: Platforms;
    link: string;
    img: string;
    description?: string;
    startDate?: string;
    endDate?: string;
    future?: boolean;
    // Whether this account already has it (unset when not known): Amazon's
    // own per-user state for Prime Gaming, Steam's ownership list for Steam,
    // and a claim tab's confirmation for Epic (see withEpicClaimStatus).
    claimed?: boolean;
    // Prime Gaming only: the store the game goes to.
    store?: string;
}