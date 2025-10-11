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
}