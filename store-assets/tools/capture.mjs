// Captures the real Chrome popup at 2x in each view of views.mjs for the store images,
// plus where the elements the callouts point at are (raw-ui/chrome/rects.js).
// Run from wxt-dev-wxt/ after `npm run build`: node ../store-assets/tools/capture.mjs
// With --locale <name> (a key of source/i18n/locales.json, e.g. pt_BR; or
// STORE_LOCALE=pt_BR) Chrome itself runs in that UI language, so the popup shows
// the catalogue and the date and hour formats a user there gets; the captures go
// to raw-ui/chrome/<name>/. macOS: through tools/chrome-applelanguages.sh (Chrome
// ignores --lang on macOS). Linux and Windows: --lang=<tag> (LANGUAGE too on Linux).
// The run fails if chrome.i18n.getUILanguage() doesn't report the language asked for.
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
const LOCALE = localeArgument();
const LOCALE_TAG = LOCALE ? localeTag(LOCALE) : null;
const OUT_DIR = path.join(TOOLS_DIR, "..", "raw-ui", "chrome", ...(LOCALE ? [LOCALE] : []));
const DIST_DIR = path.resolve("dist/chrome-mv3");
const POPUP_WIDTH = 360;
const POPUP_MAX_HEIGHT = 600;
const SCALE = 2;
const { VIEWS, viewStorage } = await import("./views.mjs");

function localeArgument() {
    const i = process.argv.indexOf("--locale");
    const name = i >= 0 ? process.argv[i + 1] : process.env.STORE_LOCALE;
    if (i >= 0 && !name) throw new Error("--locale needs a name, e.g. --locale pt_BR");
    if (name === "en") throw new Error("English is the default: run without --locale");
    return name || null;
}

function localeTag(name) {
    const config = JSON.parse(fs.readFileSync(path.join(TOOLS_DIR, "..", "source", "i18n", "locales.json"), "utf8"));
    const locale = config.locales[name];
    if (!locale) throw new Error(`unknown locale ${name}; source/i18n/locales.json has ${Object.keys(config.locales).join(", ")}`);
    return locale.tag;
}

// How Chrome is started in LOCALE_TAG: see the header.
function localeLaunchOptions() {
    if (!LOCALE_TAG) return { channel: "chromium", locale: "en-US", args: [] };
    if (process.platform === "darwin") {
        return {
            executablePath: path.join(TOOLS_DIR, "chrome-applelanguages.sh"),
            env: { ...process.env, STORE_CHROME_BINARY: chromium.executablePath(), STORE_APPLE_LANGUAGE: LOCALE_TAG },
            args: [],
        };
    }
    return {
        channel: "chromium",
        env: { ...process.env, LANGUAGE: LOCALE_TAG.replace("-", "_") },
        args: [`--lang=${LOCALE_TAG}`],
    };
}

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
// A localized run sets no Playwright locale: the page's Intl and navigator.language
// then come from Chrome's own UI language, as for a user.
const { args: localeArgs, ...launchOptions } = localeLaunchOptions();
const context = await chromium.launchPersistentContext(path.join(workDir, "profile"), {
    ...launchOptions,
    headless: true,
    colorScheme: "dark",
    deviceScaleFactor: SCALE,
    viewport: { width: POPUP_WIDTH, height: POPUP_MAX_HEIGHT },
    args: [`--disable-extensions-except=${extDir}`, `--load-extension=${extDir}`, "--hide-scrollbars", ...localeArgs],
});
const errors = [];
const rects = {};
try {
    fs.mkdirSync(OUT_DIR, { recursive: true });
    const page = await context.newPage();
    // A localized macOS run also opens Chrome's start page (see the wrapper).
    for (const other of context.pages()) if (other !== page) await other.close();
    page.on("pageerror", (e) => errors.push(String(e)));
    const popupUrl = `chrome-extension://${unpackedId(extDir)}/popup.html`;
    await page.goto(popupUrl);
    if (LOCALE_TAG) {
        const uiLanguage = await page.evaluate(() => chrome.i18n.getUILanguage());
        if (uiLanguage.toLowerCase() !== LOCALE_TAG.toLowerCase()) {
            throw new Error(`Chrome runs in ${uiLanguage}, not ${LOCALE_TAG}: its UI language didn't take`);
        }
    }
    // The first load writes its defaults to storage: let it finish before seeding.
    await page.waitForTimeout(1500);
    for (const [name, view] of Object.entries(VIEWS)) {
        await page.evaluate(async (data) => {
            await chrome.storage.local.clear();
            await chrome.storage.local.set(data);
        }, viewStorage(view));
        await page.setViewportSize({ width: POPUP_WIDTH, height: POPUP_MAX_HEIGHT });
        await page.goto(popupUrl);
        await page.waitForLoadState("networkidle");
        await page.waitForFunction(() => [...document.images].every((img) => img.complete));
        // Chrome sizes a popup to its content, up to 600 px.
        const height = await page.evaluate(() => Math.ceil(document.querySelector(".App").getBoundingClientRect().height));
        await page.setViewportSize({ width: POPUP_WIDTH, height: Math.min(height, POPUP_MAX_HEIGHT) });
        await page.waitForTimeout(300);
        // Wait for a frame at the new size: a capture right after a resize can come
        // back as a tiled copy of the old surface.
        await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
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
    console.log(JSON.stringify({ locale: LOCALE ?? "en", files: fs.readdirSync(OUT_DIR), missing, errors }));
} finally {
    await context.close();
    fs.rmSync(workDir, { recursive: true, force: true });
}
