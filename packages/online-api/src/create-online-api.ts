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
import { handleGetGame, handlePostMove } from './game-handlers';
import { handleGetLog } from './game-log';
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
  | { readonly name: 'post-move'; readonly groupHash: string; readonly gameNumber: string };

const matchGet = (path: string): Route | undefined => {
  if (path === '/me') return { name: 'me' };
  if (path === '/my-games') return { name: 'my-games' };
  const invite = /^\/invites\/([^/]+)$/.exec(path);
  const token = invite?.[1];
  if (token !== undefined) return { name: 'get-invite', token };
  const log = /^\/games\/([^/]+)\/([^/]+)\/log$/.exec(path);
  const logGroup = log?.[1];
  const logGame = log?.[2];
  if (logGroup !== undefined && logGame !== undefined) {
    return { name: 'get-log', groupHash: logGroup, gameNumber: logGame };
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

const matchPost = (path: string): Route | undefined => {
  if (path === '/invites') return { name: 'create' };
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

const dispatch = (deps: OnlineApiDeps, request: OnlineRequest): Promise<OnlineHttpResult> => {
  const route = matchRoute(request.method, request.path);
  if (route === undefined) return Promise.resolve(notFound());
  switch (route.name) {
    case 'me':
      return handleMe(deps, request);
    case 'my-games':
      return handleMyGames(deps, request);
    case 'create':
      return handleCreate(deps, request);
    case 'get-invite':
      return handleGetInvite(deps, route.token);
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
    case 'post-move':
      return handlePostMove(deps, request, route.groupHash, route.gameNumber);
  }
};

export const createOnlineApi = (deps: OnlineApiDeps): OnlinePort => ({
  handle: (request: OnlineRequest): Promise<OnlineHttpResult> => dispatch(deps, request),
});
