import { defineConfig } from 'vitest/config';
import { WxtVitest } from 'wxt/testing';

// WxtVitest wires up WXT auto-imports, the `#imports` alias, an in-memory
// fake-browser (incl. browser.storage), and the `@` path alias — so storage
// and extension-API code can be tested without hand-rolled mocks.
export default defineConfig({
  plugins: [WxtVitest()],
  test: {
    // happy-dom rather than jsdom: jsdom replaces global Uint8Array/TextEncoder,
    // which trips esbuild's startup invariant and made suites flakily fail to load.
    environment: 'happy-dom',
    include: ['entrypoints/**/*.{test,spec}.ts'],
  },
});
