import { defineConfig } from 'wxt';

export default defineConfig({
  outDir: "dist",
  modules: ['@wxt-dev/module-react'],
  alias: {
    '@': '.',
  },
  manifest: {
    name: "Free Game Claimer for Steam, Epic, GOG, IndieGala & Prime Gaming",
    permissions: ['storage', "tabs", "scripting", "alarms", "declarativeNetRequestWithHostAccess"],
    host_permissions: [
      'https://store.steampowered.com/*',
      "https://store-site-backend-static-ipv4.ak.epicgames.com/*",
      "https://www.gog.com/*",
      "https://freebies.indiegala.com/*",
      "https://www.indiegala.com/*",
      "https://gaming.amazon.com/*",
      "https://luna.amazon.com/*",
      "https://account.microsoft.com/*",
      // The account.microsoft.com redeem page embeds the actual redeem form
      // as a cross-origin iframe on this separate host — confirmed live.
      "https://www.microsoft.com/store/purchase/buynowui/*"
    ],
    browser_specific_settings: {
      gecko: {
        id: '{116f2aed-395e-42cd-8bf1-1b221519911d}',
        strict_min_version: '109.0',
      },
    },
  },
});
