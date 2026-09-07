import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const repoRoot = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: { docs: resolve(repoRoot, 'docs') },
  },
  test: {
    include: ['packages/*/test/**/*.test.ts'],
    // Pure packages stay on node. The web adapter's unit tests are also pure
    // (viewport / cull / input machines) — React stays out of vitest.
    environment: 'node',
    globals: false,
    coverage: {
      provider: 'istanbul',
      reporter: ['json', 'text-summary'],
      reportsDirectory: 'coverage',
      include: [
        'packages/contracts/src/**/*.ts',
        'packages/rules-core/src/**/*.ts',
        'packages/geometry-fixtures/src/**/*.ts',
        'packages/geometry-tiling/src/**/*.ts',
      ],
      exclude: ['**/*.test.ts', '**/test/**', '**/*.d.ts'],
    },
  },
});
