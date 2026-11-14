// Renders every source/*.html at its exact store size with Chrome's popup captures into
// chrome/, and the screenshots with Firefox's into firefox/ (Firefox Add-ons has no promo
// tiles), as 24-bit RGB PNGs with no alpha, via finalize.py.
// Run from wxt-dev-wxt/ after both captures: node ../store-assets/tools/render.mjs
// --locale <name> (or STORE_LOCALE) renders that locale's Chrome screenshots instead,
// from raw-ui/chrome/<name>/ and source/i18n/<name>.json, into chrome/<name>/;
// --locale all renders every locale in source/i18n/locales.json. Locales listed under
// "copies" there (es_419) are copied from theirs (es) after it renders.
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const { chromium } = createRequire(path.resolve("package.json"))("playwright");
const ROOT = path.join(import.meta.dirname, "..");
const SOURCE_DIR = path.join(ROOT, "source");
const pages = fs.readdirSync(SOURCE_DIR).filter((file) => file.endsWith(".html")).sort();
const TARGETS = [
    { browserName: "chrome", files: pages },
    { browserName: "firefox", files: pages.filter((file) => file.startsWith("screenshot-")) },
];
const LOCALE = localeArgument();
const I18N_DIR = path.join(SOURCE_DIR, "i18n");
const I18N = JSON.parse(fs.readFileSync(path.join(I18N_DIR, "locales.json"), "utf8"));

const browser = await chromium.launch();
try {
    if (LOCALE) {
        await renderLocales(LOCALE === "all" ? Object.keys(I18N.locales) : [LOCALE]);
    } else for (const { browserName, files } of TARGETS) {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), `fgc-render-${browserName}-`));
        for (const file of files) await renderPage(file, browserName, tmpDir);
        const outDir = path.join(ROOT, browserName);
        fs.mkdirSync(outDir, { recursive: true });
        execFileSync("python3", ["-I", path.join(import.meta.dirname, "finalize.py"), tmpDir, outDir], { stdio: "inherit" });
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
} finally {
    await browser.close();
}

function localeArgument() {
    const i = process.argv.indexOf("--locale");
    const name = i >= 0 ? process.argv[i + 1] : process.env.STORE_LOCALE;
    if (i >= 0 && !name) throw new Error("--locale needs a name or all, e.g. --locale pt_BR");
    if (name === "en") throw new Error("English is the default: run without --locale");
    return name || null;
}

// Each locale's Chrome screenshots, then the locales copied from them.
async function renderLocales(names) {
    for (const name of names) {
        const locale = I18N.locales[name];
        if (!locale) throw new Error(`unknown locale ${name}; source/i18n/locales.json has ${Object.keys(I18N.locales).join(", ")}`);
        const captions = JSON.parse(fs.readFileSync(path.join(I18N_DIR, `${name}.json`), "utf8"));
        const files = pages.filter((file) => file.startsWith("screenshot-") && !(locale.skip ?? []).includes(file.replace(/\.html$/, "")));
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), `fgc-render-${name}-`));
        for (const file of files) {
            const key = file.replace(/\.html$/, "");
            if (!captions[key]) throw new Error(`source/i18n/${name}.json has no captions for ${key} (or add it to the locale's skip list)`);
            const i18n = { lang: locale.tag, captions: captions[key] };
            const shrunk = await renderPage(file, "chrome", tmpDir, { locale: name, i18n });
            console.log(`${name} ${key}${shrunk ? `: shrunk ${shrunk}` : ""}`);
        }
        const outDir = path.join(ROOT, "chrome", name);
        fs.rmSync(outDir, { recursive: true, force: true });
        fs.mkdirSync(outDir, { recursive: true });
        execFileSync("python3", ["-I", path.join(import.meta.dirname, "finalize.py"), tmpDir, outDir], { stdio: "inherit" });
        fs.rmSync(tmpDir, { recursive: true, force: true });
        for (const [copy, from] of Object.entries(I18N.copies ?? {})) {
            if (from !== name) continue;
            fs.rmSync(path.join(ROOT, "chrome", copy), { recursive: true, force: true });
            fs.cpSync(outDir, path.join(ROOT, "chrome", copy), { recursive: true });
            console.log(`copied chrome/${name}/ to chrome/${copy}/`);
        }
    }
}

// In the page: callout labels must stay inside the image, off the popup and off each other.
function calloutProblems() {
    const box = (el) => el.getBoundingClientRect();
    const shot = box(document.querySelector(".shot"));
    const popup = box(document.querySelector(".popup"));
    const overlap = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
    const labels = [...document.querySelectorAll(".callout")].map((el) => ({ text: el.textContent, r: box(el) }));
    const problems = [];
    labels.forEach((l, i) => {
        if (l.r.left < shot.left || l.r.right > shot.right || l.r.top < shot.top || l.r.bottom > shot.bottom) problems.push(`"${l.text}" leaves the image`);
        if (overlap(l.r, popup)) problems.push(`"${l.text}" overlaps the popup`);
        for (const m of labels.slice(i + 1)) if (overlap(l.r, m.r)) problems.push(`"${l.text}" overlaps "${m.text}"`);
    });
    return problems;
}

async function renderPage(file, browserName, tmpDir, { locale = null, i18n = null } = {}) {
    const page = await browser.newPage({ viewport: { width: 1400, height: 800 }, deviceScaleFactor: 1 });
    if (i18n) await page.addInitScript((value) => { window.STORE_I18N = value; }, i18n);
    await page.goto(`file://${path.join(SOURCE_DIR, file)}?browser=${browserName}${locale ? `&locale=${locale}` : ""}`);
    await page.waitForFunction(() => document.body.dataset.ready, null, { timeout: 30_000 });
    const ready = await page.evaluate(() => document.body.dataset.ready);
    if (ready !== "1") throw new Error(`${file}${locale ? ` (${locale})` : ""}: ${ready}`);
    let shrunk = null;
    if (locale) {
        const problems = await page.evaluate(calloutProblems);
        if (problems.length) throw new Error(`${file} (${locale}): ${problems.join("; ")}`);
        const fit = JSON.parse(await page.evaluate(() => document.body.dataset.shrunk ?? "{}"));
        shrunk = Object.entries(fit).filter(([, v]) => v).map(([k, v]) => `${k} ${v}`).join(", ") || null;
    }
    const root = page.locator(".shot, .tile").first();
    const box = await root.boundingBox();
    await page.setViewportSize({ width: Math.round(box.width), height: Math.round(box.height) });
    const out = path.join(tmpDir, file.replace(/\.html$/, ".png"));
    await root.screenshot({ path: out });
    await page.close();
    return shrunk;
}
