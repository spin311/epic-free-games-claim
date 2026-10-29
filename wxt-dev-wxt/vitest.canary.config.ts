import { defineConfig } from 'vitest/config';
import { WxtVitest } from 'wxt/testing';

// `npm run canary`: the live store checks in canary/, kept out of `npm test`
// (see canary/stores.canary.ts). Node environment so fetch is Node's own,
// not a DOM emulation's with CORS rules.
export default defineConfig({
  plugins: [WxtVitest()],
  test: {
    environment: 'node',
    include: ['canary/**/*.canary.ts'],
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
});
