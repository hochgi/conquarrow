import type { Plugin } from 'vite';
import {
  BYOK_UPSTREAM_ALLOWLIST,
  BYOK_UPSTREAM_HEADER,
  isAllowedByokUpstream,
} from './src/byokConfig';

/** Minimal shapes — avoid depending on @types/node in the web package. */
interface DevReq {
  readonly method?: string;
  readonly url?: string;
  readonly headers: Record<string, string | string[] | undefined>;
  setEncoding: (enc: string) => void;
  on: (event: string, listener: (arg?: string | Error) => void) => void;
}

interface DevRes {
  statusCode: number;
  setHeader: (name: string, value: string) => void;
  end: (body?: string) => void;
}

const readBody = (req: DevReq): Promise<string> =>
  new Promise((resolve, reject) => {
    const chunks: string[] = [];
    req.setEncoding('utf8');
    req.on('data', (chunk) => {
      if (typeof chunk === 'string') chunks.push(chunk);
    });
    req.on('end', () => {
      resolve(chunks.join(''));
    });
    req.on('error', (err) => {
      reject(err instanceof Error ? err : new Error('read failed'));
    });
  });

/**
 * Same-origin BYOK relay for `pnpm dev` only.
 * Pages prefers direct CORS-ok hosts (ADR 0003). A personal AWS relay is still
 * the fallback for hosts that refuse the browser — never employer.
 *
 * Also proxies `/__turn/*` → local turn runner (`pnpm byok-turn`, default :4010).
 */
export const byokDevProxy = (): Plugin => ({
  name: 'arrows-byok-dev-proxy',
  configureServer(server) {
    const turnPort = 4010;
    server.middlewares.use((req, res, next) => {
      const r = req as unknown as DevReq;
      const rawUrl = r.url ?? '';
      if (!rawUrl.startsWith('/__turn')) {
        next();
        return;
      }
      void (async () => {
        const out = res as unknown as DevRes;
        const path = rawUrl.slice('/__turn'.length) || '/';
        const target = `http://127.0.0.1:${String(turnPort)}${path}`;
        if (r.method === 'OPTIONS') {
          out.statusCode = 204;
          out.setHeader('Access-Control-Allow-Origin', '*');
          out.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
          out.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
          out.end();
          return;
        }
        try {
          const body =
            r.method === 'POST' || r.method === 'PUT' ? await readBody(r) : undefined;
          const upstreamRes = await fetch(target, {
            method: r.method ?? 'GET',
            headers: { 'Content-Type': 'application/json' },
            ...(body !== undefined ? { body } : {}),
          });
          const text = await upstreamRes.text();
          out.statusCode = upstreamRes.status;
          const ct = upstreamRes.headers.get('content-type');
          if (ct !== null) out.setHeader('Content-Type', ct);
          out.setHeader('Access-Control-Allow-Origin', '*');
          out.end(text);
        } catch (err) {
          out.statusCode = 502;
          out.setHeader('Content-Type', 'application/json');
          out.end(
            JSON.stringify({
              ok: false,
              error:
                err instanceof Error
                  ? `${err.message} (is pnpm byok-turn running on :${String(turnPort)}?)`
                  : 'turn runner unreachable',
            }),
          );
        }
      })().catch((err: unknown) => {
        next(err);
      });
    });

    server.middlewares.use('/__byok', (req, res, next) => {
      void (async () => {
        const r = req as unknown as DevReq;
        const out = res as unknown as DevRes;
        if (r.method === 'OPTIONS') {
          out.statusCode = 204;
          out.setHeader('Access-Control-Allow-Origin', '*');
          out.setHeader(
            'Access-Control-Allow-Headers',
            `Authorization, Content-Type, ${BYOK_UPSTREAM_HEADER}`,
          );
          out.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
          out.end();
          return;
        }
        if (r.method !== 'POST') {
          out.statusCode = 405;
          out.end('POST only');
          return;
        }
        const upstreamHeader = r.headers[BYOK_UPSTREAM_HEADER.toLowerCase()];
        const upstream = typeof upstreamHeader === 'string' ? upstreamHeader : '';
        if (!isAllowedByokUpstream(upstream)) {
          out.statusCode = 403;
          out.setHeader('Content-Type', 'application/json');
          out.end(
            JSON.stringify({
              error: `upstream not allowlisted (allowed: ${BYOK_UPSTREAM_ALLOWLIST.join(', ')}, *.openai.azure.com)`,
            }),
          );
          return;
        }
        const auth = r.headers['authorization'];
        if (typeof auth !== 'string' || auth.length === 0) {
          out.statusCode = 401;
          out.setHeader('Content-Type', 'application/json');
          out.end(JSON.stringify({ error: 'missing Authorization' }));
          return;
        }
        try {
          const body = await readBody(r);
          const upstreamRes = await fetch(upstream, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: auth,
            },
            body,
          });
          const text = await upstreamRes.text();
          out.statusCode = upstreamRes.status;
          const ct = upstreamRes.headers.get('content-type');
          if (ct !== null) out.setHeader('Content-Type', ct);
          out.end(text);
        } catch (err) {
          out.statusCode = 502;
          out.setHeader('Content-Type', 'application/json');
          out.end(
            JSON.stringify({
              error: err instanceof Error ? err.message : 'upstream fetch failed',
            }),
          );
        }
      })().catch((err: unknown) => {
        next(err);
      });
    });
  },
});
