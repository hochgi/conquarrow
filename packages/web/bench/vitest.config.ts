import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

/**
 * P79 BYOK benchmark — its own Vitest config, outside `pnpm test` and CI.
 *
 * The `docs` alias is the one `vite.config.ts` and the root `vitest.config.ts`
 * both carry, so `docs/byok-teaching.md?raw` and the workspace packages resolve
 * exactly as they do in the app. `bench/run.mjs` loads this same file to run a
 * tier, so the harness's own tests and a real run see one module graph.
 */
const benchRoot = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(benchRoot, '../../..');

export default defineConfig({
  resolve: {
    alias: { docs: resolve(repoRoot, 'docs') },
  },
  test: {
    root: benchRoot,
    include: ['test/**/*.test.ts'],
    environment: 'node',
    globals: false,
    // A scripted match runs the real heuristic seat, which searches.
    testTimeout: 600_000,
    hookTimeout: 600_000,
  },
});
