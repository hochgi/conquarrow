// P79 launcher: `pnpm byok-bench <tier> [options]`.
//
// Loads `src/cli.ts` through Vite's SSR loader with the bench's own Vitest
// config, so `docs/byok-teaching.md?raw` and the workspace packages resolve
// exactly as they do in the app and in `pnpm byok-bench:test`. `__worker` is
// the internal entry for one parallel worker process (see src/workers.ts).
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const benchDir = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const worker = args[0] === '__worker';

const server = await createServer({
  configFile: join(benchDir, 'vitest.config.ts'),
  root: benchDir,
  appType: 'custom',
  logLevel: worker ? 'silent' : 'warn',
  server: { middlewareMode: true, hmr: false, ws: false },
  optimizeDeps: { noDiscovery: true, include: [] },
});

try {
  const cli = await server.ssrLoadModule(join(benchDir, 'src/cli.ts'));
  process.exitCode = worker
    ? await cli.workerMain(readFileSync(0, 'utf8'))
    : await cli.main(args, cli.nodeIo());
} catch (err) {
  // `main` redacts its own errors; this catches the loader and a worker's
  // failures, and redacts them the same way before printing.
  const key = (process.env.BYOK_API_KEY ?? '').trim();
  const message = err instanceof Error ? err.message : 'failed to start';
  process.stderr.write(`byok-bench: ${key.length > 0 ? message.split(key).join('[redacted]') : message}\n`);
  process.exitCode = 1;
} finally {
  await server.close();
}
