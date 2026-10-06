/**
 * API Gateway HTTP event → `OnlineRequest`, and the HTTP Lambda handler over
 * `createOnlineApi`. Pure mapping; the entry file (`http.ts`) only reads env and
 * builds the leaves.
 *
 * Both payload formats are read: v2 (`requestContext.http.method`, `rawPath`,
 * `rawQueryString`) and v1 (`httpMethod`, `path`).
 */

import type {
  OnlineHeaders,
  OnlineHttpResult,
  OnlineRequest,
} from '@conquarrow/contracts';
import type { OnlineApiDeps } from './api-types';
import { createOnlineApi } from './create-online-api';
import { asRecord } from './invite-record';

const headerValue = (
  headers: Record<string, unknown> | undefined,
  name: string,
): string | undefined => {
  if (headers === undefined) return undefined;
  const direct = headers[name];
  if (typeof direct === 'string') return direct;
  const lower = headers[name.toLowerCase()];
  if (typeof lower === 'string') return lower;
  return undefined;
};

const eventMethod = (event: Record<string, unknown>): 'GET' | 'POST' => {
  const ctx = asRecord(event['requestContext']);
  const http = ctx === undefined ? undefined : asRecord(ctx['http']);
  const fromCtx = http?.['method'];
  if (fromCtx === 'POST') return 'POST';
  if (typeof event['httpMethod'] === 'string' && event['httpMethod'] === 'POST') {
    return 'POST';
  }
  return 'GET';
};

const eventPath = (event: Record<string, unknown>): string => {
  const raw = event['rawPath'];
  if (typeof raw === 'string' && raw.length > 0) return raw;
  const path = event['path'];
  if (typeof path === 'string' && path.length > 0) return path;
  return '/';
};

const eventHeaders = (event: Record<string, unknown>): OnlineHeaders | undefined => {
  const raw = asRecord(event['headers']);
  const authorization = headerValue(raw, 'authorization');
  const ifMatch = headerValue(raw, 'if-match');
  if (authorization === undefined && ifMatch === undefined) return undefined;
  return {
    ...(authorization === undefined ? {} : { authorization }),
    ...(ifMatch === undefined ? {} : { ifMatch }),
  };
};

/**
 * `queryStringParameters` (both payload formats decode it the same way), or the
 * `rawQueryString` v2 carries alongside it. P49's `since` is the only reader.
 */
const eventQuery = (
  event: Record<string, unknown>,
): Readonly<Record<string, string>> | undefined => {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(asRecord(event['queryStringParameters']) ?? {})) {
    if (typeof value === 'string') out[key] = value;
  }
  const raw = event['rawQueryString'];
  if (typeof raw === 'string' && raw.length > 0) {
    for (const [key, value] of new URLSearchParams(raw)) {
      out[key] ??= value;
    }
  }
  return Object.keys(out).length === 0 ? undefined : out;
};

const eventBody = (event: Record<string, unknown>): string | undefined => {
  const body = event['body'];
  if (typeof body !== 'string') return undefined;
  if (event['isBase64Encoded'] === true) {
    const bytes = Uint8Array.from(atob(body), (ch) => ch.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  }
  return body;
};

export const toOnlineRequest = (event: unknown): OnlineRequest => {
  const rec = asRecord(event) ?? {};
  const headers = eventHeaders(rec);
  const body = eventBody(rec);
  const query = eventQuery(rec);
  return {
    method: eventMethod(rec),
    path: eventPath(rec),
    ...(headers === undefined ? {} : { headers }),
    ...(query === undefined ? {} : { query }),
    ...(body === undefined ? {} : { body }),
  };
};

/** The HTTP Lambda handler: every event through `toOnlineRequest` into the port. */
export const createHttpHandler = (
  deps: OnlineApiDeps,
): ((event: unknown) => Promise<OnlineHttpResult>) => {
  const api = createOnlineApi(deps);
  return (event) => api.handle(toOnlineRequest(event));
};
