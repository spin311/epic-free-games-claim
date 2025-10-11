import { defineConfig } from 'wxt';

export default defineConfig({
  outDir: "dist",
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: "Free Game Claimer for Steam & Epic",
    permissions: ['storage', "tabs", "scripting"],
    host_permissions: [
      'https://store.steampowered.com/*',
      "https://store-site-backend-static-ipv4.ak.epicgames.com/*"
    ],
  },
});
