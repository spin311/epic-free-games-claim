import { defineConfig } from 'wxt';

export default defineConfig({
  outDir: "dist",
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: "Free Game Claimer for Steam & Epic",
    permissions: ['storage', "tabs"],
  },
});
