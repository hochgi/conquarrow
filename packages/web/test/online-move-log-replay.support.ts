/**
 * Fixtures for the P49 move-log replay suite. Builds on the P19 pages fakes —
 * same injected fetch, socket, session and location.
 *
 * @see docs/spec/online-move-log-replay/online-move-log-replay.md
 */

import { DEFAULT_MATCH_CONFIG, endTurn, mintArrowId, skip, step } from '@conquarrow/contracts';
import type {
  ArrowId,
  GameState,
  Move,
  OnlineGameBoard,
  OnlinePagesHttpRequest,
  ReplayBatch,
  StateChangedPayload,
} from '@conquarrow/contracts';
import { makeMatch, makeTiling } from '@conquarrow/geometry-tiling';
import { makeRules } from '@conquarrow/rules-core';
import type { LogWindow } from '../src/online-replay';
import { GAME_ONE, GROUP_HASH, boardAt } from './online-web.support';
import type { FetchSpy, ScriptedFetch } from './online-web.support';

export const geometry = makeTiling();
export const rules = makeRules(geometry);

export const arrow = (name: string): ArrowId => mintArrowId(name);

/** A named marker move — identity matters, legality does not, on the wire. */
export const mark = (name: string): Move => skip(arrow(name));

export const pass = (): Move => endTurn();

/** A step — the only move kind that shows the camera anything. */
export const hop = (from: string, to: string): Move => step(arrow(from), arrow(to), 1);

export const openingThree = (): GameState =>
  makeMatch({ ...DEFAULT_MATCH_CONFIG, playerCount: 3 });

/** The first legal step of `state`, for a batch that has to be applicable. */
export const firstLegalStep = (state: GameState): Move => {
  for (const move of rules.legalMoves(state)) {
    if (move.kind === 'step') return step(move.from, move.exit, 1);
  }
  throw new Error('fixture: no legal step');
};

export const logWindow = (
  from: number,
  to: number,
  moves: readonly Move[],
  gap = false,
): LogWindow => ({ from, to, gap, moves });

export const batch = (from: number, to: number, moves: readonly Move[]): ReplayBatch => ({
  from,
  to,
  moves,
});

export const logRoute = (groupHash = GROUP_HASH, gameNumber = GAME_ONE): string =>
  `/games/${groupHash}/${gameNumber}/log`;

export const logScript = (
  window: LogWindow,
  groupHash = GROUP_HASH,
  gameNumber = GAME_ONE,
): ScriptedFetch => ({
  method: 'GET',
  path: logRoute(groupHash, gameNumber),
  status: 200,
  body: window,
});

/** The log request the client cannot use — a 5xx, a timeout mapped to one. */
export const failedLogScript = (
  status = 500,
  groupHash = GROUP_HASH,
  gameNumber = GAME_ONE,
): ScriptedFetch => ({
  method: 'GET',
  path: logRoute(groupHash, gameNumber),
  status,
  rawBody: '',
});

export const snapshotScript = (
  version: number,
  groupHash = GROUP_HASH,
  gameNumber = GAME_ONE,
): ScriptedFetch => ({
  method: 'GET',
  path: `/games/${groupHash}/${gameNumber}`,
  status: 200,
  body: boardAt(version, { tag: `v${String(version)}` }),
});

export const snapshotBoard = (version: number): OnlineGameBoard =>
  boardAt(version, { tag: `v${String(version)}` });

export const wake = (
  version: number,
  groupHash = GROUP_HASH,
  gameNumber = GAME_ONE,
): StateChangedPayload => ({
  type: 'stateChanged',
  version,
  groupHash,
  gameNumber,
});

export const sinceOf = (req: OnlinePagesHttpRequest): string | undefined => {
  const query = req.url.split('?')[1];
  if (query === undefined) return undefined;
  return new URLSearchParams(query).get('since') ?? undefined;
};

export const logRequests = (
  h: FetchSpy,
  groupHash = GROUP_HASH,
  gameNumber = GAME_ONE,
): readonly OnlinePagesHttpRequest[] =>
  h.fetchLog.filter(
    (req) =>
      req.method === 'GET' &&
      (req.url.split('?')[0] ?? req.url).endsWith(logRoute(groupHash, gameNumber)),
  );

export const sincesRequested = (h: FetchSpy): readonly (string | undefined)[] =>
  logRequests(h).map(sinceOf);
