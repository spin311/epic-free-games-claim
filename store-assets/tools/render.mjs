// Renders every source/*.html at its exact store size and saves it to chrome/ as a
// 24-bit RGB PNG with no alpha (the Chrome Web Store's format), via finalize.py.
// Run from wxt-dev-wxt/ after capture.mjs: node ../store-assets/tools/render.mjs
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const { chromium } = createRequire(path.resolve("package.json"))("playwright");
const ROOT = path.join(import.meta.dirname, "..");
const SOURCE_DIR = path.join(ROOT, "source");
const OUT_DIR = path.join(ROOT, "chrome");
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "fgc-render-"));

const browser = await chromium.launch();
try {
    const pages = fs.readdirSync(SOURCE_DIR).filter((file) => file.endsWith(".html")).sort();
    for (const file of pages) {
        const page = await browser.newPage({ viewport: { width: 1400, height: 800 }, deviceScaleFactor: 1 });
        // file:// pages can't load ../raw-ui scripts in a fresh profile without this.
        await page.goto(`file://${path.join(SOURCE_DIR, file)}`);
        await page.waitForFunction(() => document.body.dataset.ready, null, { timeout: 30_000 });
        const ready = await page.evaluate(() => document.body.dataset.ready);
        if (ready !== "1") throw new Error(`${file}: ${ready}`);
        const root = page.locator(".shot, .tile").first();
        const box = await root.boundingBox();
        await page.setViewportSize({ width: Math.round(box.width), height: Math.round(box.height) });
        const out = path.join(tmpDir, file.replace(/\.html$/, ".png"));
        await root.screenshot({ path: out });
        await page.close();
        console.log(`${file}: ${Math.round(box.width)}x${Math.round(box.height)}`);
    }
} finally {
    await browser.close();
}
fs.mkdirSync(OUT_DIR, { recursive: true });
execFileSync("python3", ["-I", path.join(import.meta.dirname, "finalize.py"), tmpDir, OUT_DIR], { stdio: "inherit" });
fs.rmSync(tmpDir, { recursive: true, force: true });
