/**
 * API Gateway WebSocket event → `$connect` / `$disconnect` request, and the WS
 * Lambda handler over an `OnlineWsPort`. Pure mapping; the entry file (`ws.ts`)
 * only reads env and builds the leaves.
 *
 * Fails closed: no event, no `connectionId`, or a route that is neither
 * `$connect` nor `$disconnect` is 401 without touching the port.
 */

import type {
  OnlineWsPort,
  OnlineWsResult,
  WsConnectRequest,
  WsDisconnectRequest,
} from '@conquarrow/contracts';
import { asRecord } from './invite-record';

export type WsAction =
  | { readonly route: '$connect'; readonly request: WsConnectRequest }
  | { readonly route: '$disconnect'; readonly request: WsDisconnectRequest }
  | { readonly route: 'unauthorized' };

const UNAUTHORIZED: WsAction = { route: 'unauthorized' };

const connectionIdOf = (ctx: Record<string, unknown>): string | undefined => {
  const id = ctx['connectionId'];
  return typeof id === 'string' && id.length > 0 ? id : undefined;
};

const routeOf = (ctx: Record<string, unknown>): '$connect' | '$disconnect' | undefined => {
  const routeKey = ctx['routeKey'];
  if (routeKey === '$connect' || routeKey === '$disconnect') return routeKey;
  const eventType = ctx['eventType'];
  if (eventType === 'CONNECT') return '$connect';
  if (eventType === 'DISCONNECT') return '$disconnect';
  return undefined;
};

const accessTokenOf = (event: Record<string, unknown>): string | undefined => {
  const query = asRecord(event['queryStringParameters']);
  const token = query?.['access_token'];
  return typeof token === 'string' && token.length > 0 ? token : undefined;
};

/** `$connect` takes its Google ID token from the `access_token` query parameter. */
export const toWsAction = (event: unknown): WsAction => {
  const rec = asRecord(event);
  if (rec === undefined) return UNAUTHORIZED;
  const ctx = asRecord(rec['requestContext']);
  if (ctx === undefined) return UNAUTHORIZED;
  const connectionId = connectionIdOf(ctx);
  if (connectionId === undefined) return UNAUTHORIZED;
  const route = routeOf(ctx);
  if (route === '$disconnect') return { route, request: { connectionId } };
  if (route !== '$connect') return UNAUTHORIZED;
  const accessToken = accessTokenOf(rec);
  return {
    route,
    request: accessToken === undefined ? { connectionId } : { connectionId, accessToken },
  };
};

/** The WebSocket Lambda handler: one event, one port call or a 401. */
export const createWsHandler =
  (ws: OnlineWsPort): ((event?: unknown) => Promise<OnlineWsResult>) =>
  (event) => {
    const action = toWsAction(event);
    if (action.route === '$connect') return ws.connect(action.request);
    if (action.route === '$disconnect') return ws.disconnect(action.request);
    return Promise.resolve({ statusCode: 401 });
  };
