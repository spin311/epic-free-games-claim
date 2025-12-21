import {FreeGame} from "@/entrypoints/types/freeGame.ts";

export type FreeGamesResponse = {
    freeGames: FreeGame[];
    loggedIn: boolean;
}