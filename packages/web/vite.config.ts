import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { byokDevProxy } from './vite.byok-proxy';

const webRoot = dirname(fileURLToPath(import.meta.url));
const docsDir = resolve(webRoot, '../../docs');

/**
 * GitHub Pages serves this package at `/conquarrow/` under
 * `games.hochgi.com` (same pattern as `ninja_grip`). Use `--mode pages` for that
 * deploy; local `vite` / default `vite build` keep `/`.
 *
 * BYOK: Pages calls the host directly when Proxy URL is empty (ADR 0003).
 * `pnpm dev` still mounts `/__byok` for hosts that refuse browser CORS.
 */
export default defineConfig(({ mode }) => ({
  base: mode === 'pages' ? '/conquarrow/' : '/',
  plugins: [react(), byokDevProxy()],
  root: '.',
  server: { port: 5173 },
  resolve: {
    // Workspace packages export .ts sources; Vite handles them directly.
    alias: { docs: docsDir },
    dedupe: ['react', 'react-dom'],
  },
}));
