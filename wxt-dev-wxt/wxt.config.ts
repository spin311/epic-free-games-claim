import { defineConfig } from 'wxt';
import { copyFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
// Relative imports: the config loads outside Vite, so the `@/` alias isn't set up yet.
import { withOptionalHostAccess } from './entrypoints/utils/optionalAccess.ts';
import { RUNTIME_CONTENT_SCRIPT_MATCHES } from './entrypoints/utils/runtimeContentScripts.ts';

export default defineConfig({
  outDir: "dist",
  modules: ['@wxt-dev/module-react'],
  // GPL-3.0 requires the license text to travel with every copy. The repo-root
  // LICENSE is the only one in git: the hooks below copy it into the extension
  // output, and briefly into this folder so the sources zip stores it as
  // LICENSE (a '../LICENSE' entry would climb out of the archive).
  zip: {
    includeSources: ['LICENSE'],
  },
  alias: {
    '@': '.',
  },
  manifest: {
    // addons.mozilla.org rejects names over 45 characters.
    name: "Free Game Claimer: Epic, Steam, GOG, Prime",
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
        // declarativeNetRequestWithHostAccess (the Luna lookup's Origin
        // rewrite) needs Firefox 113.
        strict_min_version: '113.0',
      },
    },
  },
  hooks: {
    'zip:sources:start': async (wxt) => {
      await copyFile(join(wxt.config.root, '..', 'LICENSE'), join(wxt.config.root, 'LICENSE'));
    },
    'zip:sources:done': async (wxt) => {
      await rm(join(wxt.config.root, 'LICENSE'), { force: true });
    },
    'build:done': async (wxt) => {
      // In the sources zip (where reviewers rebuild) LICENSE sits in the root;
      // in the repo it is one level up.
      const ownLicense = join(wxt.config.root, 'LICENSE');
      const license = existsSync(ownLicense) ? ownLicense : join(wxt.config.root, '..', 'LICENSE');
      await copyFile(license, join(wxt.config.outDir, 'LICENSE'));
    },
    // WXT adds every runtime content script's matches to host_permissions;
    // those and the optional groups' origins move to the optional list. The
    // hook's contract is to edit the manifest it's handed, hence the assign.
    'build:manifestGenerated': (wxt, manifest) => {
      Object.assign(manifest, withOptionalHostAccess(manifest, wxt.config.manifestVersion, RUNTIME_CONTENT_SCRIPT_MATCHES));
    },
  },
});
