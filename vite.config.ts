import { defineConfig } from 'vitest/config';

export default defineConfig({
  // VexFlow (~1 MB) and the ~1,700-cell fragment library are needed at startup; the bundle is ~365 kB gzipped.
  build: { chunkSizeWarningLimit: 1300 },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    // Many tests generate hundreds of licks to check musical statistics (a lick takes ~10 ms, more on CI runners), so
    // the 5 s default is too tight for them; a real hang still fails.
    testTimeout: 30_000,
  },
});
