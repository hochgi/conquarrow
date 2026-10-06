import { defineConfig } from 'vitest/config';

/**
 * online-api's suite alone — the test runner for `stryker.online-api.config.json`.
 * The root `vitest.config.ts` runs every package; a mutant in an online-api
 * leaf only needs online-api's tests.
 */
export default defineConfig({
  test: {
    include: ['packages/online-api/test/**/*.test.ts'],
    environment: 'node',
    globals: false,
  },
});
