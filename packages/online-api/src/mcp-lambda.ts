/**
 * MCP Lambda composition root (P92). Maps one API Gateway event onto
 * `handleMcpHttp` and builds the leaves. Not imported by the door.
 *
 * @see docs/spec/remote-agent-mcp/remote-agent-mcp.md
 */

import { createHmac, randomBytes } from 'node:crypto';
import { env } from 'node:process';
import { ApiGatewayManagementApiClient } from '@aws-sdk/client-apigatewaymanagementapi';
import { createApiGatewayPostToConnection } from './apigw-post-to-connection';
import { readEntryEnv } from './entry-env';
import { createGoogleTokenInfoVerifier } from './google-tokeninfo';
import { asRecord } from './invite-record';
import { handleMcpHttp } from './mcp-door';
import type { McpAccessClaims, McpHttpRequest, McpHttpResult } from './mcp-http';
import { pagesHeuristic } from './pages-heuristic';
import { createS3Store } from './s3-store';

const base64url = (bytes: Uint8Array): string => {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
};

const fromBase64url = (text: string): Uint8Array => {
  const padded = text.replaceAll('-', '+').replaceAll('_', '/') + '='.repeat((4 - (text.length % 4)) % 4);
  const binary = atob(padded);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
};

const sameText = (left: string, right: string): boolean => {
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let i = 0; i < left.length; i += 1) {
    diff |= left.charCodeAt(i) ^ right.charCodeAt(i);
  }
  return diff === 0;
};

const jsonBytes = (value: unknown): Uint8Array => new TextEncoder().encode(JSON.stringify(value));

const signHs256 = (secret: string, claims: McpAccessClaims): string => {
  const header = base64url(jsonBytes({ alg: 'HS256', typ: 'JWT' }));
  const payload = base64url(jsonBytes(claims));
  const signature = createHmac('sha256', secret).update(`${header}.${payload}`).digest('base64url');
  return `${header}.${payload}.${signature}`;
};

const verifyHs256 = (secret: string, token: string): McpAccessClaims | undefined => {
  const parts = token.split('.');
  if (parts.length !== 3) return undefined;
  const [header, payload, signature] = parts;
  if (header === undefined || payload === undefined || signature === undefined) return undefined;
  const expected = createHmac('sha256', secret).update(`${header}.${payload}`).digest('base64url');
  if (!sameText(signature, expected)) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(fromBase64url(payload))) as unknown;
  } catch {
    return undefined;
  }
  const rec = asRecord(parsed);
  if (rec === undefined) return undefined;
  const iss = rec['iss'];
  const aud = rec['aud'];
  const sub = rec['sub'];
  const iat = rec['iat'];
  const exp = rec['exp'];
  if (
    typeof iss !== 'string' ||
    typeof aud !== 'string' ||
    typeof sub !== 'string' ||
    typeof iat !== 'number' ||
    typeof exp !== 'number'
  ) {
    return undefined;
  }
  return { iss, aud, sub, iat, exp };
};

const eventMethod = (event: Record<string, unknown>): McpHttpRequest['method'] => {
  const ctx = asRecord(event['requestContext']);
  const http = ctx === undefined ? undefined : asRecord(ctx['http']);
  const fromCtx = http?.['method'];
  const raw = typeof fromCtx === 'string' ? fromCtx : event['httpMethod'];
  if (raw === 'POST') return 'POST';
  if (raw === 'DELETE') return 'DELETE';
  return 'GET';
};

const eventPath = (event: Record<string, unknown>): string => {
  const raw = event['rawPath'];
  if (typeof raw === 'string' && raw.length > 0) return raw;
  const path = event['path'];
  if (typeof path === 'string' && path.length > 0) return path;
  return '/';
};

const eventHeaders = (event: Record<string, unknown>): McpHttpRequest['headers'] => {
  const raw = asRecord(event['headers']);
  if (raw === undefined) return undefined;
  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value === 'string') headers[key] = value;
  }
  return headers;
};

const eventQuery = (event: Record<string, unknown>): McpHttpRequest['query'] => {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(asRecord(event['queryStringParameters']) ?? {})) {
    if (typeof value === 'string') out[key] = value;
  }
  const raw = event['rawQueryString'];
  if (typeof raw === 'string' && raw.length > 0) {
    for (const [key, value] of new URLSearchParams(raw)) out[key] ??= value;
  }
  return Object.keys(out).length === 0 ? undefined : out;
};

const eventBody = (event: Record<string, unknown>): string | undefined => {
  const body = event['body'];
  if (typeof body !== 'string') return undefined;
  if (event['isBase64Encoded'] === true) {
    const binary = atob(body);
    const bytes = Uint8Array.from(binary, (ch) => ch.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  }
  return body;
};

const toMcpRequest = (event: unknown): McpHttpRequest => {
  const rec = asRecord(event) ?? {};
  const headers = eventHeaders(rec);
  const query = eventQuery(rec);
  const body = eventBody(rec);
  return {
    method: eventMethod(rec),
    path: eventPath(rec),
    ...(headers === undefined ? {} : { headers }),
    ...(query === undefined ? {} : { query }),
    ...(body === undefined ? {} : { body }),
  };
};

const createHandler = (): ((event: unknown) => Promise<McpHttpResult>) => {
  const config = readEntryEnv(env);
  const clientId = env['GOOGLE_AUTH_CLIENT_ID'] ?? '';
  const clientSecret = env['GOOGLE_AUTH_CLIENT_SECRET'] ?? '';
  const jwtSecret = env['MCP_JWT_SECRET'] ?? '';
  const clock = (): number => Date.now();
  const post =
    config.wsManagementEndpoint === undefined
      ? undefined
      : createApiGatewayPostToConnection(
          new ApiGatewayManagementApiClient({ endpoint: config.wsManagementEndpoint }),
        );
  const redirectUri = 'https://mcp.games.hochgi.com/oauth/callback';
  return (event) =>
    handleMcpHttp(
      {
        store: createS3Store(config.matchBucket),
        postToConnection: post ?? (() => Promise.resolve(410)),
        google: createGoogleTokenInfoVerifier({
          clientIds: clientId === '' ? [] : [clientId],
          clock,
          fetch: globalThis.fetch,
        }),
        googleCodeExchange: {
          exchange: async (code, redirect, verifier) => {
            const body = new URLSearchParams({
              code,
              client_id: clientId,
              client_secret: clientSecret,
              redirect_uri: redirect === '' ? redirectUri : redirect,
              grant_type: 'authorization_code',
            });
            if (verifier !== undefined) body.set('code_verifier', verifier);
            const res = await fetch('https://oauth2.googleapis.com/token', {
              method: 'POST',
              headers: { 'content-type': 'application/x-www-form-urlencoded' },
              body: body.toString(),
            });
            const parsed = asRecord(await res.json());
            const idToken = parsed?.['id_token'];
            if (!res.ok || typeof idToken !== 'string') {
              throw new Error('google code exchange failed');
            }
            return { idToken };
          },
        },
        metadata: {
          fetch: async (url) => {
            const res = await fetch(url);
            if (!res.ok) throw new Error('metadata fetch failed');
            return res.text();
          },
        },
        clock,
        signer: {
          sign: (claims) => signHs256(jwtSecret, claims),
          verify: (token) => verifyHs256(jwtSecret, token),
        },
        log: {
          write: (line) => {
            console.log(line);
          },
        },
        randomBytes: (size) => randomBytes(size),
        heuristic: pagesHeuristic,
        ...(clientId === '' ? {} : { googleAuthClientId: clientId }),
      },
      toMcpRequest(event),
    );
};

let built: ((event: unknown) => Promise<McpHttpResult>) | undefined;

/** API Gateway entry. Leaves are built on the first invocation, not at import. */
export const handler = (event: unknown): Promise<McpHttpResult> => {
  built ??= createHandler();
  return built(event);
};
