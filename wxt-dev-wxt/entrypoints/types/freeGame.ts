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
    // Prime Gaming only, from Amazon's own per-user state (unset when not
    // known): whether this account already collected it, and the store it
    // goes to.
    claimed?: boolean;
    store?: string;
}