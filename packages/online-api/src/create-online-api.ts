/**
 * In-process factory for the online HTTP port (P17 invites, P18 moves).
 *
 * Google verify, hashing, invite persistence, Start, GET game, POST moves, and
 * WebSocket registry live here. Tests inject a fake verifier, a fake object
 * store, a scripted heuristic, and a fake PostToConnection.
 *
 * @see docs/spec/online-auth-invites/online-auth-invites.md
 * @see docs/spec/online-moves-ws/online-moves-ws.md
 */

import type { OnlineHttpResult, OnlinePort, OnlineRequest } from '@conquarrow/contracts';
import type { OnlineApiDeps } from './api-types';
import { handleGetGame, handleGetVersion, handlePostMove } from './game-handlers';
import { handleGetExport } from './game-export';
import { handleGetLog } from './game-log';
import { handleManageGame, type ManageAction } from './game-manage';
import {
  handleAccept,
  handleCreate,
  handleGetInvite,
  handleMe,
  handleMyGames,
  handleRevoke,
  handleStart,
} from './handlers';
import { notFound } from './json-result';

export type {
  GoogleRejectReason,
  GoogleVerifier,
  GoogleVerifyResult,
  HeuristicChooser,
  ObjectPutOptions,
  ObjectStore,
  OnlineApiDeps,
  PostToConnection,
} from './api-types';
export { PreconditionFailed } from './api-types';
export { createOnlineWs } from './create-online-ws';

type Route =
  | { readonly name: 'me' }
  | { readonly name: 'my-games' }
  | { readonly name: 'create' }
  | { readonly name: 'get-invite'; readonly token: string }
  | { readonly name: 'accept'; readonly token: string }
  | { readonly name: 'revoke'; readonly token: string }
  | { readonly name: 'start'; readonly token: string }
  | { readonly name: 'get-game'; readonly groupHash: string; readonly gameNumber: string }
  | { readonly name: 'get-log'; readonly groupHash: string; readonly gameNumber: string }
  | { readonly name: 'get-version'; readonly groupHash: string; readonly gameNumber: string }
  | { readonly name: 'get-export'; readonly groupHash: string; readonly gameNumber: string }
  | {
      readonly name: 'manage';
      readonly action: ManageAction;
      readonly groupHash: string;
      readonly gameNumber: string;
    }
  | { readonly name: 'post-move'; readonly groupHash: string; readonly gameNumber: string };

const SUB_ROUTES: Readonly<Record<string, 'get-log' | 'get-version' | 'get-export'>> = {
  log: 'get-log',
  version: 'get-version',
  export: 'get-export',
};

const matchGet = (path: string): Route | undefined => {
  if (path === '/me') return { name: 'me' };
  if (path === '/my-games') return { name: 'my-games' };
  const invite = /^\/invites\/([^/]+)$/.exec(path);
  const token = invite?.[1];
  if (token !== undefined) return { name: 'get-invite', token };
  const sub = /^\/games\/([^/]+)\/([^/]+)\/(log|version|export)$/.exec(path);
  const subGroup = sub?.[1];
  const subGame = sub?.[2];
  if (subGroup !== undefined && subGame !== undefined) {
    return { name: SUB_ROUTES[sub?.[3] ?? 'log'] ?? 'get-log', groupHash: subGroup, gameNumber: subGame };
  }
  const game = /^\/games\/([^/]+)\/([^/]+)$/.exec(path);
  const groupHash = game?.[1];
  const gameNumber = game?.[2];
  if (groupHash !== undefined && gameNumber !== undefined) {
    return { name: 'get-game', groupHash, gameNumber };
  }
  return undefined;
};

const matchInviteAction = (path: string): Route | undefined => {
  const action = /^\/invites\/([^/]+)\/(accept|revoke|start)$/.exec(path);
  const token = action?.[1];
  const verb = action?.[2];
  if (token === undefined) return undefined;
  if (verb === 'accept') return { name: 'accept', token };
  if (verb === 'revoke') return { name: 'revoke', token };
  if (verb === 'start') return { name: 'start', token };
  return undefined;
};

const matchManage = (path: string): Route | undefined => {
  const manage = /^\/games\/([^/]+)\/([^/]+)\/(delete|name|hide)$/.exec(path);
  const groupHash = manage?.[1];
  const gameNumber = manage?.[2];
  const action = manage?.[3];
  if (groupHash === undefined || gameNumber === undefined) return undefined;
  if (action !== 'delete' && action !== 'name' && action !== 'hide') return undefined;
  return { name: 'manage', action, groupHash, gameNumber };
};

const matchPost = (path: string): Route | undefined => {
  if (path === '/invites') return { name: 'create' };
  const managed = matchManage(path);
  if (managed !== undefined) return managed;
  const move = /^\/games\/([^/]+)\/([^/]+)\/moves$/.exec(path);
  const groupHash = move?.[1];
  const gameNumber = move?.[2];
  if (groupHash !== undefined && gameNumber !== undefined) {
    return { name: 'post-move', groupHash, gameNumber };
  }
  return matchInviteAction(path);
};

const matchRoute = (method: OnlineRequest['method'], path: string): Route | undefined =>
  method === 'GET' ? matchGet(path) : matchPost(path);

const dispatch = (
  deps: OnlineApiDeps,
  request: OnlineRequest,
  route: Route | undefined,
): Promise<OnlineHttpResult> => {
  if (route === undefined) return Promise.resolve(notFound());
  switch (route.name) {
    case 'me':
      return handleMe(deps, request);
    case 'my-games':
      return handleMyGames(deps, request);
    case 'create':
      return handleCreate(deps, request);
    case 'get-invite':
      return handleGetInvite(deps, request, route.token);
    case 'accept':
      return handleAccept(deps, request, route.token);
    case 'revoke':
      return handleRevoke(deps, request, route.token);
    case 'start':
      return handleStart(deps, request, route.token);
    case 'get-game':
      return handleGetGame(deps, request, route.groupHash, route.gameNumber);
    case 'get-log':
      return handleGetLog(deps, request, route.groupHash, route.gameNumber);
    case 'get-version':
      return handleGetVersion(deps, request, route.groupHash, route.gameNumber);
    case 'post-move':
      return handlePostMove(deps, request, route.groupHash, route.gameNumber);
    case 'get-export':
      return handleGetExport(deps, request, route.groupHash, route.gameNumber);
    case 'manage':
      return handleManageGame(deps, request, route.action, route.groupHash, route.gameNumber);
  }
};

/**
 * P95 D7: one line per response — the route's *name*, never its path, so no
 * group hash or invite token reaches the log.
 */
const logSize = (
  deps: OnlineApiDeps,
  request: OnlineRequest,
  route: Route | undefined,
  result: OnlineHttpResult,
): void => {
  const bytes = new TextEncoder().encode(result.body).length;
  const name = route === undefined ? 'unknown' : route.name === 'manage' ? route.action : route.name;
  deps.log?.(JSON.stringify({ http: `${request.method} ${name}`, status: result.statusCode, bytes }));
};

export const createOnlineApi = (deps: OnlineApiDeps): OnlinePort => ({
  handle: async (request: OnlineRequest): Promise<OnlineHttpResult> => {
    const route = matchRoute(request.method, request.path);
    const result = await dispatch(deps, request, route);
    logSize(deps, request, route, result);
    return result;
  },
});
