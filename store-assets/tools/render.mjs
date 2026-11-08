// Renders every source/*.html at its exact store size with Chrome's popup captures into
// chrome/, and the screenshots with Firefox's into firefox/ (Firefox Add-ons has no promo
// tiles), as 24-bit RGB PNGs with no alpha, via finalize.py.
// Run from wxt-dev-wxt/ after both captures: node ../store-assets/tools/render.mjs
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

const browser = await chromium.launch();
try {
    for (const { browserName, files } of TARGETS) {
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

async function renderPage(file, browserName, tmpDir) {
    const page = await browser.newPage({ viewport: { width: 1400, height: 800 }, deviceScaleFactor: 1 });
    await page.goto(`file://${path.join(SOURCE_DIR, file)}?browser=${browserName}`);
    await page.waitForFunction(() => document.body.dataset.ready, null, { timeout: 30_000 });
    const ready = await page.evaluate(() => document.body.dataset.ready);
    if (ready !== "1") throw new Error(`${file}: ${ready}`);
    const root = page.locator(".shot, .tile").first();
    const box = await root.boundingBox();
    await page.setViewportSize({ width: Math.round(box.width), height: Math.round(box.height) });
    const out = path.join(tmpDir, file.replace(/\.html$/, ".png"));
    await root.screenshot({ path: out });
    await page.close();
}
