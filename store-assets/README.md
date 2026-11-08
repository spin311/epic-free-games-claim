# Store listing images

Ready to upload, all 24-bit RGB PNGs with no alpha:

- `chrome/`: Chrome Web Store. Five 1280×800 screenshots, the 440×280 small promo tile
  and the 1400×560 marquee.
- `firefox/`: Firefox Add-ons. The same five screenshots with the popup as Firefox
  renders it (Add-ons has no promo tiles).

They show the real popup (captured from the built extension) in a plain browser
window on a flat background, with one headline and one line each.

## Rebuilding them

Run everything from `wxt-dev-wxt/` (Playwright comes from its `node_modules`):

```bash
npm run build && npm run build:firefox                       # the popup the images show
node ../store-assets/tools/capture.mjs                       # Chrome captures -> raw-ui/chrome/
MOZ_REMOTE_ALLOW_SYSTEM_ACCESS=1 python3 ../store-assets/tools/capture_firefox.py   # -> raw-ui/firefox/
node ../store-assets/tools/render.mjs                        # -> store-assets/chrome/ and firefox/
```

`capture_firefox.py` needs `pip install selenium pillow` (Selenium Manager fetches
geckodriver) and Firefox in /Applications.

- `tools/showcaseGames.mjs` is the games the popup shows: well-known titles that really
  were given away through the store each card names (GTA V, Death Stranding and
  Civilization VI on Epic; Fallout 3, Fallout: New Vegas and XCOM 2 as Prime Gaming GOG
  codes; Total War: SHOGUN 2 on Steam), with when, in comments. Their dates are
  illustrative. Keep it to games that were really free there.
- `tools/views.mjs` is the popup states the images show (storage for each, and the
  elements the callouts point at), shared by both captures.
- `tools/capture.mjs` (Chrome) and `tools/capture_firefox.py` (Firefox) load a copy of
  the build with no background (nothing is checked or claimed) and the optional hosts
  granted, seed storage for each view, and save the popup at 2x plus the positions the
  callouts point at (`raw-ui/<browser>/rects.js`).
- `tools/render.mjs` renders each `source/*.html` at its exact size, with Chrome's
  captures and then Firefox's (`?browser=firefox`), and saves it through
  `tools/finalize.py` (Pillow), which drops the alpha channel.

Captions and callouts are in `source/*.html`; the look is in `source/store.css` and the
browser window, popup placement and callout lines in `source/layout.js`. Captions use
Mona Sans (SIL Open Font License), in `source/fonts/`.
