import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { byokDevProxy } from './vite.byok-proxy';

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
    dedupe: ['react', 'react-dom'],
  },
}));
