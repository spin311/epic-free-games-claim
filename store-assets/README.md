# Chrome Web Store images

`chrome/` holds the listing images, ready to upload: five 1280×800 screenshots, the
440×280 small promo tile and the 1400×560 marquee, all 24-bit RGB PNGs with no alpha.

They show the real popup (captured from the built extension) in a plain browser
window on a flat background, with one headline and one line each.

## Rebuilding them

Run everything from `wxt-dev-wxt/` (Playwright comes from its `node_modules`):

```bash
npm run build                                            # the popup the images show
npx vite-node --config vitest.canary.config.ts ../store-assets/tools/fetchDemoData.ts   # optional: today's giveaways
node ../store-assets/tools/capture.mjs                   # popup captures -> store-assets/raw-ui/
node ../store-assets/tools/render.mjs                    # compositions -> store-assets/chrome/
```

- `tools/fetchDemoData.ts` reads today's giveaways, signed out, with the extension's own
  parsers (Epic, Steam, IndieGala, and Prime Gaming from a Luna page; it opens a browser
  window) and saves `tools/demoData.json`. Skip it to keep the current data. When the
  games change, `capture.mjs` names the Prime Gaming and IndieGala titles it shows: pick
  ones from the new data.
- `tools/capture.mjs` loads a copy of `dist/chrome-mv3` with no background (nothing is
  checked or claimed) and the optional hosts granted, seeds storage for each view, and
  saves the popup at 2x plus the positions the callouts point at (`raw-ui/rects.js`).
- `tools/render.mjs` renders each `source/*.html` at its exact size and saves it through
  `tools/finalize.py` (Pillow), which drops the alpha channel.

Captions and callouts are in `source/*.html`; the look is in `source/store.css` and the
browser window, popup placement and callout lines in `source/layout.js`. Captions use
Mona Sans (SIL Open Font License), in `source/fonts/`.
