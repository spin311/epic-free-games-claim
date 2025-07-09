import { defineConfig } from 'wxt';

export default defineConfig({
  outDir: "dist",
  modules: ['@wxt-dev/module-react'],
  manifest: {
    permissions: ['storage', "tabs"],
    background: {
      service_worker: "background.ts",
      type: "module"
    }
  },
});
