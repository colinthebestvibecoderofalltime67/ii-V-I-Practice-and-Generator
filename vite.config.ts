import { defineConfig } from 'vitest/config';

export default defineConfig({
  // VexFlow (~1 MB) and the ~1,700-cell fragment library are needed at startup; the bundle is ~365 kB gzipped.
  build: { chunkSizeWarningLimit: 1300 },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
