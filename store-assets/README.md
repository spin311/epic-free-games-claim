# Store listing images

Ready to upload, all 24-bit RGB PNGs with no alpha:

- `chrome/`: Chrome Web Store. Five 1280×800 screenshots, the 440×280 small promo tile
  and the 1400×560 marquee.
- `chrome/<locale>/`: the same screenshots per language (zh_CN, zh_TW, pt_BR, es,
  es_419, fr, vi), with translated captions and the popup as Chrome shows it in that
  language. zh_CN, zh_TW and vi have no `3-prime`. See "Localized screenshots" below.
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
Mona Sans (SIL Open Font License, `source/fonts/OFL.txt`), in `source/fonts/`.

## Localized screenshots

In the Chrome Web Store dashboard each language of the listing can have its own
screenshots. A user browsing in that language sees those first, then the global
(English) ones.

- `source/i18n/locales.json` lists the locales: the Chrome language each is captured
  in (`tag`), the screenshots it skips (`skip`: `screenshot-3-prime` for zh_CN, zh_TW
  and vi, where Prime Gaming isn't offered) and the locales copied from another one
  (`copies`: es_419 from es).
- `source/i18n/<locale>.json` holds the captions, keyed by page: `h` headline,
  `s` subline, `c` the callouts in the page's order. English stays in the HTML.
- The popup is captured with Chrome itself running in that language, so it shows the
  translated catalogue and local date and hour formats (zh_TW's hour reads 下午6:00),
  not English text with a swapped catalogue. On macOS Chrome ignores `--lang`, so
  `tools/chrome-applelanguages.sh` starts it with `-AppleLanguages "(<tag>)"`; on Linux
  and Windows `capture.mjs` passes `--lang=<tag>` (and `LANGUAGE` on Linux). The
  capture stops if `chrome.i18n.getUILanguage()` reports another language. Only the
  macOS route has been run so far.
- Headlines and sublines stay on one line: one that would wrap shrinks in 0.5 px steps
  (not below 36 px and 17 px; the render fails past that, so shorten the text). A
  render also fails if a callout label leaves the image or overlaps the popup or
  another label.
- Chinese captions use PingFang SC/TC (Noto Sans SC/TC or Microsoft YaHei/JhengHei
  elsewhere) for the characters Mona Sans doesn't have; Vietnamese uses Mona Sans'
  vietnamese subset.

Regenerate one locale, from `wxt-dev-wxt/` after `npm run build`:

```bash
node ../store-assets/tools/capture.mjs --locale pt_BR   # -> raw-ui/chrome/pt_BR/
node ../store-assets/tools/render.mjs --locale pt_BR    # -> store-assets/chrome/pt_BR/
```

All of them (`--locale es` also refreshes `chrome/es_419/`):

```bash
for l in zh_CN zh_TW pt_BR es fr vi; do node ../store-assets/tools/capture.mjs --locale $l; done
node ../store-assets/tools/render.mjs --locale all
```

`STORE_LOCALE=pt_BR` works in place of `--locale pt_BR`. Both scripts use Playwright's
bundled Chromium (`npx playwright install chromium` once) and `render.mjs` needs Pillow
(`pip install pillow`). The committed images were made with Chrome for Testing 157; a
newer or older Chromium can shift anti-aliasing slightly. To add a language, add it to
`locales.json` with its Chrome tag, write `<locale>.json`, capture and render it.
