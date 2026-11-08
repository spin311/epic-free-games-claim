// The popup states the store images show, shared by capture.mjs (Chrome) and
// capture_firefox.py (Firefox, which reads them as JSON: node views.mjs).
import * as showcase from "./showcaseGames.mjs";

const GAMES = {
    epicGames: showcase.epicGames,
    futureGames: showcase.futureGames,
    primeGamingGames: showcase.primeGamingGames,
    steamGames: showcase.steamGames,
    indieGalaGames: showcase.indieGalaGames,
    gogGames: [],
};

// A long-time user: every store on and signed in, the prompts already answered.
export const BASE = {
    ...GAMES,
    active: true,
    counter: 128,
    claimFrequency: "daily",
    claimHour: 18,
    steamCheck: true, epicCheck: true, gogCheck: true,
    indieGalaCheck: true, indieGalaWheelCheck: true,
    primeGamingCheck: true, primeGamingClaimAmazonGames: true, primeGamingClaimEpic: true, primeGamingClaimGog: true,
    steamLoggedIn: true, epicLoggedIn: true, gogLoggedIn: true, indieGalaLoggedIn: true, primeGamingLoggedIn: true,
    primeGamingHasPrime: true,
    steamMinPositivePercent: 70,
    showFutureGames: true,
    reviewPrompt: "rated", reviewPromptAnsweredAt: 1, sponsorPrompt: "dismissed",
};

// name -> storage on top of BASE, and the elements the callouts point at.
export const VIEWS = {
    "popup-games": {
        data: { activeTab: "free-games" },
        targets: { filter: ".filter-bar", store: ".game-card:nth-child(3) .game-meta" },
    },
    "popup-library": {
        data: { activeTab: "free-games", visiblePlatforms: ["Epic Games"], epicClaimed: ["p/death-stranding"] },
        targets: { until: ".game-meta", upcoming: ".game-upcoming", library: ".game-claimed" },
    },
    "popup-settings": {
        data: { activeTab: "main", primeGamingCheck: false, indieGalaLoggedIn: false },
        targets: {
            switch: ".switch", schedule: ".schedule-row", rating: "#steam-review-threshold",
            login: ".login-status.logged-out",
        },
    },
    "popup-prime": {
        data: { activeTab: "main", steamCheck: false, indieGalaCheck: false },
        targets: { grid: ".option-grid", prime: ".platform-group:last-child .login-status" },
    },
    "popup-pending": {
        data: {
            activeTab: "free-games",
            pendingRedemptions: [showcase.pendingRedemption],
        },
        targets: { actions: ".pending-redemption-actions" },
    },
};

// Fill the popup's storage with BASE plus the view's own values.
export function viewStorage(view) {
    return { ...BASE, ...view.data };
}

if (process.argv[1] === import.meta.filename) {
    console.log(JSON.stringify(Object.fromEntries(Object.entries(VIEWS).map(([name, view]) => [
        name, { storage: viewStorage(view), targets: view.targets },
    ]))));
}
