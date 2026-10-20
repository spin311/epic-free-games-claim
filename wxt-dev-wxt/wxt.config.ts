import { defineConfig } from 'wxt';
// Relative imports: the config loads outside Vite, so the `@/` alias isn't set up yet.
import { withOptionalHostAccess } from './entrypoints/utils/optionalAccess.ts';
import { RUNTIME_CONTENT_SCRIPT_MATCHES } from './entrypoints/utils/runtimeContentScripts.ts';

export default defineConfig({
  outDir: "dist",
  modules: ['@wxt-dev/module-react'],
  alias: {
    '@': '.',
  },
  manifest: {
    name: "Free Game Claimer for Steam, Epic, GOG, IndieGala & Prime Gaming",
    permissions: ['storage', "tabs", "scripting", "alarms", "declarativeNetRequestWithHostAccess"],
    // Only the hosts 2.6.1 shipped with: Chrome disables an extension on update
    // until the user approves any new install-time host. Every other host is
    // optional, requested from the popup (see entrypoints/utils/optionalAccess.ts).
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
  hooks: {
    // WXT adds every runtime content script's matches to host_permissions;
    // those and the optional groups' origins move to the optional list. The
    // hook's contract is to edit the manifest it's handed, hence the assign.
    'build:manifestGenerated': (wxt, manifest) => {
      Object.assign(manifest, withOptionalHostAccess(manifest, wxt.config.manifestVersion, RUNTIME_CONTENT_SCRIPT_MATCHES));
    },
  },
});
