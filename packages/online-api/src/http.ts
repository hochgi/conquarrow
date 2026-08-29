/**
 * HTTP API Lambda entry: map API Gateway events onto `OnlinePort.handle`.
 *
 * Google verification stays behind `GoogleVerifier` (tokeninfo; `sub` / `aud` /
 * `exp` only). S3 is the object-store adapter. Env: `GOOGLE_CLIENT_IDS`,
 * `MATCH_BUCKET`.
 */

import { randomBytes } from 'node:crypto';
import { env } from 'node:process';
import {
  ApiGatewayManagementApiClient,
  PostToConnectionCommand,
} from '@aws-sdk/client-apigatewaymanagementapi';
import type { OnlineHeaders, OnlineHttpResult, OnlineRequest } from '@conquarrow/contracts';
import type { PostToConnection } from './api-types';
import { createOnlineApi } from './create-online-api';
import { createGoogleTokenInfoVerifier } from './google-tokeninfo';
import { asRecord } from './invite-record';
import { pagesHeuristic } from './pages-heuristic';
import { createS3Store } from './s3-store';

const clientIds = (): readonly string[] =>
  (env['GOOGLE_CLIENT_IDS'] ?? '')
    .split(',')
    .map((id) => id.trim())
    .filter((id) => id.length > 0);

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

const clock = (): number => Date.now();

const statusOfAwsError = (error: unknown): number | undefined => {
  if (typeof error !== 'object' || error === null) return undefined;
  const rec = error as Record<string, unknown>;
  if (rec['name'] === 'GoneException') return 410;
  const meta = rec['$metadata'];
  if (typeof meta !== 'object' || meta === null) return undefined;
  const code = (meta as Record<string, unknown>)['httpStatusCode'];
  return typeof code === 'number' ? code : undefined;
};

const createAwsPostToConnection = (endpoint: string): PostToConnection => {
  const client = new ApiGatewayManagementApiClient({ endpoint });
  return async (connectionId, payload) => {
    try {
      await client.send(
        new PostToConnectionCommand({
          ConnectionId: connectionId,
          Data: new TextEncoder().encode(JSON.stringify(payload)),
        }),
      );
      return 200;
    } catch (error: unknown) {
      if (statusOfAwsError(error) === 410) return 410;
      throw error;
    }
  };
};

const postToConnection = (): PostToConnection | undefined => {
  const endpoint = env['WS_MANAGEMENT_ENDPOINT'];
  if (endpoint === undefined || endpoint === '') return undefined;
  return createAwsPostToConnection(endpoint);
};

const post = postToConnection();
const api = createOnlineApi({
  google: createGoogleTokenInfoVerifier({
    clientIds: clientIds(),
    clock,
    fetch: globalThis.fetch,
  }),
  s3: createS3Store(env['MATCH_BUCKET'] ?? ''),
  clock,
  randomBytes: (size) => randomBytes(size),
  heuristic: pagesHeuristic,
  ...(post === undefined ? {} : { postToConnection: post }),
});

export const handler = (event: unknown): Promise<OnlineHttpResult> =>
  api.handle(toOnlineRequest(event));
