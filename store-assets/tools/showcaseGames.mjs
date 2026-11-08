// The games the store images show: well-known titles that really were given away
// through the store each card names (checked Nov 2026; sources below), so the
// listing shows what the extension has claimed for people. The dates are
// illustrative, around the time the images were made, not the original ones.
// Art is each game's Steam header image (official key art, like what the stores show).

const steamHeader = (appId) => `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${appId}/header.jpg`;

// Free on the Epic Games Store: GTA V May 14-21 2020, then Civilization VI May 21-28
// 2020 (the week after, so it's the "upcoming" one); Death Stranding Dec 25 2022 and
// again in the May 2023 Mega Sale.
export const epicGames = [
    {
        title: "Grand Theft Auto V",
        platform: "Epic Games",
        link: "https://store.epicgames.com/en-US/p/grand-theft-auto-v",
        img: steamHeader(271590),
        description: "Three very different criminals, one city. Pull off heists across Los Santos and Blaine County, then take it online.",
        startDate: "2026-11-12T16:00:00.000Z",
        endDate: "2026-11-19T16:00:00.000Z",
    },
    {
        title: "Death Stranding",
        platform: "Epic Games",
        link: "https://store.epicgames.com/en-US/p/death-stranding",
        img: steamHeader(1190460),
        description: "Hideo Kojima's journey across a broken America: reconnect its last cities, one delivery at a time.",
        startDate: "2026-11-12T16:00:00.000Z",
        endDate: "2026-11-19T16:00:00.000Z",
    },
];

export const futureGames = [
    {
        title: "Sid Meier's Civilization VI",
        platform: "Epic Games",
        link: "https://store.epicgames.com/en-US/p/sid-meiers-civilization-vi",
        img: steamHeader(289070),
        description: "Build an empire to stand the test of time, from the first city to the space race.",
        startDate: "2026-11-19T16:00:00.000Z",
        endDate: "2026-11-26T16:00:00.000Z",
        future: true,
    },
];

// Prime Gaming, October 2025, all three as GOG codes: XCOM 2 (Oct 9), Fallout: New
// Vegas Ultimate Edition (Oct 16), Fallout 3: Game of the Year Edition (Oct 23).
export const primeGamingGames = [
    {
        title: "Fallout 3: Game of the Year Edition",
        platform: "Prime Gaming",
        store: "GOG",
        link: "https://luna.amazon.com/claims/home",
        img: steamHeader(22370),
    },
    {
        title: "XCOM 2",
        platform: "Prime Gaming",
        store: "GOG",
        link: "https://luna.amazon.com/claims/home",
        img: steamHeader(268500),
    },
];

// Free to keep on Steam: Total War: SHOGUN 2, April 27 - May 1 2020 (Sega's
// #StayHomeSaveLives giveaway).
export const steamGames = [
    {
        title: "Total War: SHOGUN 2",
        platform: "Steam",
        link: "https://store.steampowered.com/app/34330/",
        img: steamHeader(34330),
    },
];

// Real IndieGala freebies (Nov 2026), read with the extension's own parser.
export const indieGalaGames = [
    {
        title: "My Darkest Witch",
        platform: "IndieGala",
        link: "https://freebies.indiegala.com/my-darkest-witch",
        img: "https://www.indiegalacdn.com/imgs/devs/freebies/products/9303ce41-bad2-40e2-8b3f-728d85fcb2dc/prodmain/1761983673.png",
    },
    {
        title: "Last Room",
        platform: "IndieGala",
        link: "https://freebies.indiegala.com/last-room",
        img: "https://www.indiegalacdn.com/imgs/devs/freebies/products/f48e776f-acb0-4e07-b6f7-a3a43cc6c8a8/prodmain/1761152904.png",
    },
];

// The Prime Gaming GOG code the pending-redemption screenshot shows (the code is made up).
export const pendingRedemption = {
    title: "Fallout: New Vegas Ultimate Edition",
    platform: "GOG",
    code: "7K2Q-MX4D-PN8R-W3ZT",
    redeemUrl: "https://www.gog.com/redeem/7K2QMX4DPN8RW3ZT",
};
