import { defineConfig } from 'vitest/config';

export default defineConfig({
  // VexFlow (~1 MB) and the ~2,300-cell fragment library (incl. Focus cells) are needed at startup; ~390 kB gzipped.
  build: { chunkSizeWarningLimit: 1400 },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    // Many tests generate hundreds of licks to check musical statistics (a lick takes ~10 ms, more on CI runners), so
    // the 5 s default is too tight for them; a real hang still fails.
    testTimeout: 30_000,
  },
});
