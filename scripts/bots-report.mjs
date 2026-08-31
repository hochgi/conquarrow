#!/usr/bin/env node
/**
 * Advisory bot-vs-bot metric table (P53), in the spirit of `pnpm crap`.
 * Not a CI gate. Loads workspace TypeScript via vite-node (same resolver as Vitest).
 */
import { existsSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const viteNodeCli = (): string | undefined => {
  const pnpm = join(root, 'node_modules/.pnpm');
  if (existsSync(pnpm)) {
    const dir = readdirSync(pnpm).find((name) => name.startsWith('vite-node@'));
    if (dir !== undefined) {
      const cli = join(pnpm, dir, 'node_modules/vite-node/vite-node.mjs');
      if (existsSync(cli)) return cli;
    }
  }
  const nested = join(root, 'node_modules/vite-node/vite-node.mjs');
  return existsSync(nested) ? nested : undefined;
};

const cli = viteNodeCli();
if (cli === undefined) {
  console.error('pnpm bots: vite-node not found (install deps with pnpm)');
  process.exit(1);
}
const runner = join(root, 'scripts/bots-report-run.ts');
const result = spawnSync(process.execPath, [cli, runner], { stdio: 'inherit', cwd: root });
process.exit(result.status === null ? 1 : result.status);
