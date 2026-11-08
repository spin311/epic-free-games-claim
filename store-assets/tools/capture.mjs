// Captures the real popup at 2x with the showcase games (showcaseGames.mjs) for the
// store images, plus where the elements the callouts point at are (raw-ui/rects.js).
// Run from wxt-dev-wxt/ after `npm run build`: node ../store-assets/tools/capture.mjs
// The extension is loaded from a copy without its background (nothing is checked or
// claimed) and with its optional hosts granted, as a user who turned every store on.
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Playwright comes from wxt-dev-wxt/node_modules (the working directory), not from here.
const { chromium } = createRequire(path.resolve("package.json"))("playwright");
const TOOLS_DIR = import.meta.dirname;
const OUT_DIR = path.join(TOOLS_DIR, "..", "raw-ui");
const DIST_DIR = path.resolve("dist/chrome-mv3");
const POPUP_WIDTH = 360;
const POPUP_MAX_HEIGHT = 600;
const SCALE = 2;
const showcase = await import("./showcaseGames.mjs");

const GAMES = {
    epicGames: showcase.epicGames,
    futureGames: showcase.futureGames,
    primeGamingGames: showcase.primeGamingGames,
    steamGames: showcase.steamGames,
    indieGalaGames: showcase.indieGalaGames,
    gogGames: [],
};

// A long-time user: every store on and signed in, the prompts already answered.
const BASE = {
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
const VIEWS = {
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

// An unpacked extension's id: sha256 of its absolute path, hex digits mapped to a-p.
function unpackedId(dir) {
    return [...createHash("sha256").update(fs.realpathSync(dir)).digest("hex").slice(0, 32)]
        .map((c) => String.fromCharCode(97 + parseInt(c, 16))).join("");
}

function prepareExtension(workDir) {
    const extDir = path.join(workDir, "ext");
    fs.cpSync(DIST_DIR, extDir, { recursive: true });
    const manifestPath = path.join(extDir, "manifest.json");
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    delete manifest.background;
    delete manifest.content_scripts;
    const optional = manifest.optional_host_permissions ?? [];
    manifest.host_permissions = [...manifest.host_permissions, ...optional.filter((o) => !o.includes("luna.amazon.") || o === "https://luna.amazon.com/*")];
    delete manifest.optional_host_permissions;
    fs.writeFileSync(manifestPath, JSON.stringify(manifest));
    return extDir;
}

const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "fgc-capture-"));
const extDir = prepareExtension(workDir);
const context = await chromium.launchPersistentContext(path.join(workDir, "profile"), {
    channel: "chromium",
    headless: true,
    locale: "en-US",
    colorScheme: "dark",
    deviceScaleFactor: SCALE,
    viewport: { width: POPUP_WIDTH, height: POPUP_MAX_HEIGHT },
    args: [`--disable-extensions-except=${extDir}`, `--load-extension=${extDir}`, "--hide-scrollbars"],
});
const errors = [];
const rects = {};
try {
    fs.mkdirSync(OUT_DIR, { recursive: true });
    const page = await context.newPage();
    page.on("pageerror", (e) => errors.push(String(e)));
    const popupUrl = `chrome-extension://${unpackedId(extDir)}/popup.html`;
    await page.goto(popupUrl);
    // The first load writes its defaults to storage: let it finish before seeding.
    await page.waitForTimeout(1500);
    for (const [name, view] of Object.entries(VIEWS)) {
        await page.evaluate(async (data) => {
            await chrome.storage.local.clear();
            await chrome.storage.local.set(data);
        }, { ...BASE, ...view.data });
        await page.setViewportSize({ width: POPUP_WIDTH, height: POPUP_MAX_HEIGHT });
        await page.goto(popupUrl);
        await page.waitForLoadState("networkidle");
        await page.waitForFunction(() => [...document.images].every((img) => img.complete));
        // Chrome sizes a popup to its content, up to 600 px.
        const height = await page.evaluate(() => Math.ceil(document.querySelector(".App").getBoundingClientRect().height));
        await page.setViewportSize({ width: POPUP_WIDTH, height: Math.min(height, POPUP_MAX_HEIGHT) });
        await page.waitForTimeout(300);
        rects[`${name}.png`] = await page.evaluate((targets) => Object.fromEntries(Object.entries(targets).map(([key, selector]) => {
            const element = document.querySelector(selector);
            if (!element) return [key, null];
            const { x, y, width, height } = element.getBoundingClientRect();
            return [key, { x, y, w: width, h: height }];
        })), view.targets);
        await page.screenshot({ path: path.join(OUT_DIR, `${name}.png`) });
    }
    fs.writeFileSync(path.join(OUT_DIR, "rects.js"), `window.RECTS = ${JSON.stringify(rects, null, 1)};\n`);
    const missing = Object.entries(rects).flatMap(([file, r]) => Object.entries(r).filter(([, v]) => !v).map(([k]) => `${file}:${k}`));
    console.log(JSON.stringify({ files: fs.readdirSync(OUT_DIR), missing, errors }));
} finally {
    await context.close();
    fs.rmSync(workDir, { recursive: true, force: true });
}
