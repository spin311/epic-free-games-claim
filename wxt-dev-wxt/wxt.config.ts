import { defineConfig } from 'wxt';

export default defineConfig({
  outDir: "dist",
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: "Free Game Claimer for Steam & Epic",
    permissions: ['storage', "tabs", "scripting", "alarms"],
    host_permissions: [
      'https://store.steampowered.com/*',
      "https://store-site-backend-static-ipv4.ak.epicgames.com/*"
    ],
    browser_specific_settings: {
      gecko: {
        id: '{116f2aed-395e-42cd-8bf1-1b221519911d}',
        strict_min_version: '109.0',
      },
    },
  },
});
