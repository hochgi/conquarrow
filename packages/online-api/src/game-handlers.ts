import type { GameState, InviteSeat, Move, OnlineHttpResult, OnlineRequest } from '@conquarrow/contracts';
import {
  ContractViolation,
  DEFAULT_MATCH_CONFIG,
  endTurn,
  mintArrowId,
  skip,
  step,
} from '@conquarrow/contracts';
import { makeMatch, makeTiling } from '@conquarrow/geometry-tiling';
import { makeRules } from '@conquarrow/rules-core';
import type { HeuristicChooser, ObjectStore, OnlineApiDeps } from './api-types';
import { isPreconditionFailed } from './api-types';
import { persistEnvelope, parsePersistedEnvelope } from './game-snapshot';
import { stampLogLine } from './game-log';
import { requireMember } from './game-member';
import { asRecord, boundUserHash } from './invite-record';
import {
  finished,
  forbidden,
  internalError,
  jsonResult,
  preconditionRequired,
  staleVersion,
  unprocessable,
} from './json-result';
import { notifyOthers } from './notify';
import { stampLibrarySummary } from './library-listing';
import { gameLogKey, gameStateKey } from './s3-keys';
import { getObject, putObject } from './store-io';

const geometry = makeTiling();
const rules = makeRules(geometry);
const MAX_MOVES_PER_TURN = 64;
const QUOTED_VERSION = /^"(\d+)"$/;

type LoadedPosition = {
  readonly version: number;
  readonly state: unknown;
  readonly game: GameState;
  readonly raw: string;
};

const openingMatch = (playerCount: number): GameState =>
  makeMatch({ ...DEFAULT_MATCH_CONFIG, playerCount });

const parseQuotedVersion = (header: string): number | undefined => {
  const match = QUOTED_VERSION.exec(header);
  const digits = match?.[1];
  if (digits === undefined) return undefined;
  return Number.parseInt(digits, 10);
};

const loadPosition = async (
  s3: ObjectStore,
  groupHash: string,
  gameNumber: string,
): Promise<LoadedPosition | undefined> => {
  const raw = await getObject(s3, gameStateKey(groupHash, gameNumber));
  if (raw === undefined) return undefined;
  const parsed = parsePersistedEnvelope(raw);
  if (parsed === undefined) return undefined;
  return { ...parsed, raw };
};

const seatIndexOfActive = (game: GameState): number => {
  const active = String(game.activePlayer);
  for (let i = 0; i < game.players.length; i += 1) {
    if (String(game.players[i]) === active) return i;
  }
  return -1;
};

const activeSeat = (seats: readonly InviteSeat[], game: GameState): InviteSeat | undefined => {
  const index = seatIndexOfActive(game);
  if (index < 0) return undefined;
  return seats[index];
};

const isHeuristicSeat = (seats: readonly InviteSeat[], game: GameState): boolean =>
  activeSeat(seats, game)?.kind === 'heuristic';

const applyMove = (game: GameState, move: Move): GameState => rules.apply(game, move);

const runBurst = (
  game: GameState,
  seats: readonly InviteSeat[],
  heuristic: HeuristicChooser,
): { readonly game: GameState; readonly moves: readonly Move[] } => {
  const moves: Move[] = [];
  let at = game;
  while (at.winner === undefined && isHeuristicSeat(seats, at)) {
    const me = at.activePlayer;
    for (let i = 0; i < MAX_MOVES_PER_TURN; i += 1) {
      if (at.winner !== undefined || at.activePlayer !== me) break;
      const move = heuristic(at);
      at = applyMove(at, move);
      moves.push(move);
    }
    if (at.winner === undefined && at.activePlayer === me) {
      const forced = endTurn();
      at = applyMove(at, forced);
      moves.push(forced);
    }
  }
  return { game: at, moves };
};

const appendLog = (
  existing: string | undefined,
  version: number,
  moves: readonly Move[],
): string => {
  if (moves.length === 0) return existing ?? '';
  // P49 D2: every move of one batch carries the version that batch produced.
  const lines = moves.map((move) => stampLogLine(version, move)).join('\n') + '\n';
  if (existing === undefined || existing === '') return lines;
  return existing.endsWith('\n') ? existing + lines : `${existing}\n${lines}`;
};

const persistPosition = async (
  s3: ObjectStore,
  groupHash: string,
  gameNumber: string,
  version: number,
  game: GameState,
  logMoves: readonly Move[],
  previousRaw: string | undefined,
): Promise<string> => {
  const body = persistEnvelope(version, game);
  if (previousRaw === undefined) {
    await putObject(s3, gameStateKey(groupHash, gameNumber), body, { ifNoneMatch: '*' });
  } else {
    await putObject(s3, gameStateKey(groupHash, gameNumber), body, { ifMatch: previousRaw });
  }
  const logKey = gameLogKey(groupHash, gameNumber);
  const existingLog = await getObject(s3, logKey);
  await putObject(s3, logKey, appendLog(existingLog, version, logMoves));
  await stampLibrarySummary(s3, groupHash, gameNumber, game);
  return body;
};

const wakeOthers = async (
  deps: OnlineApiDeps,
  seats: readonly InviteSeat[],
  callerUserHash: string,
  version: number,
  groupHash: string,
  gameNumber: string,
): Promise<void> => {
  try {
    await notifyOthers(deps.s3, deps.postToConnection, seats, callerUserHash, {
      type: 'stateChanged',
      version,
      groupHash,
      gameNumber,
    });
  } catch {
    return;
  }
};

const ensurePosition = async (
  deps: OnlineApiDeps,
  groupHash: string,
  gameNumber: string,
  seats: readonly InviteSeat[],
  callerUserHash: string,
): Promise<LoadedPosition | OnlineHttpResult> => {
  const existing = await loadPosition(deps.s3, groupHash, gameNumber);
  if (existing !== undefined) return existing;
  let game = openingMatch(seats.length);
  const heuristic = deps.heuristic;
  const burst =
    heuristic !== undefined && isHeuristicSeat(seats, game)
      ? runBurst(game, seats, heuristic)
      : { game, moves: [] };
  game = burst.game;
  try {
    const raw = await persistPosition(
      deps.s3,
      groupHash,
      gameNumber,
      0,
      game,
      burst.moves,
      undefined,
    );
    await wakeOthers(deps, seats, callerUserHash, 0, groupHash, gameNumber);
    const parsed = parsePersistedEnvelope(raw);
    if (parsed === undefined) return internalError();
    return { ...parsed, raw };
  } catch (error: unknown) {
    if (!isPreconditionFailed(error)) throw error;
    const winner = await loadPosition(deps.s3, groupHash, gameNumber);
    if (winner === undefined) return internalError();
    return winner;
  }
};

const parseMoveValue = (value: unknown): Move | undefined => {
  const rec = asRecord(value);
  if (rec === undefined) return undefined;
  const kind = rec['kind'];
  if (kind === 'endTurn') return endTurn();
  if (kind === 'skip') {
    const from = rec['from'];
    if (typeof from !== 'string') return undefined;
    return skip(mintArrowId(from));
  }
  if (kind !== 'step') return undefined;
  const from = rec['from'];
  const exit = rec['exit'];
  const count = rec['count'];
  if (typeof from !== 'string' || typeof exit !== 'string' || typeof count !== 'number') {
    return undefined;
  }
  try {
    return step(mintArrowId(from), mintArrowId(exit), count);
  } catch {
    return undefined;
  }
};

const parseMoveBody = (body: string | undefined): Move | undefined => {
  if (body === undefined) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(body) as unknown;
  } catch {
    return undefined;
  }
  const rec = asRecord(parsed);
  if (rec === undefined) return undefined;
  return parseMoveValue(rec['move']);
};

export const handleGetGame = async (
  deps: OnlineApiDeps,
  request: OnlineRequest,
  groupHash: string,
  gameNumber: string,
): Promise<OnlineHttpResult> => {
  const member = await requireMember(deps, request, groupHash, gameNumber);
  if (!member.ok) return member.result;
  const position = await ensurePosition(
    deps,
    groupHash,
    gameNumber,
    member.seats,
    member.userHash,
  );
  if ('statusCode' in position) return position;
  return jsonResult(200, {
    version: position.version,
    state: position.state,
    seats: member.seats,
  });
};

const isActiveHuman = (
  seats: readonly InviteSeat[],
  game: GameState,
  userHash: string,
): boolean => {
  const seat = activeSeat(seats, game);
  return seat !== undefined && boundUserHash(seat) === userHash;
};

export const handlePostMove = async (
  deps: OnlineApiDeps,
  request: OnlineRequest,
  groupHash: string,
  gameNumber: string,
): Promise<OnlineHttpResult> => {
  const member = await requireMember(deps, request, groupHash, gameNumber);
  if (!member.ok) return member.result;
  const ifMatch = request.headers?.ifMatch;
  if (ifMatch === undefined) return preconditionRequired();
  const position = await ensurePosition(
    deps,
    groupHash,
    gameNumber,
    member.seats,
    member.userHash,
  );
  if ('statusCode' in position) return position;
  if (parseQuotedVersion(ifMatch) !== position.version) return staleVersion();
  if (position.game.winner !== undefined) return finished();
  if (!isActiveHuman(member.seats, position.game, member.userHash)) return forbidden();
  const move = parseMoveBody(request.body);
  if (move === undefined) return unprocessable();
  let game: GameState;
  try {
    game = applyMove(position.game, move);
  } catch (error: unknown) {
    if (error instanceof ContractViolation) return unprocessable();
    throw error;
  }
  const applied: Move[] = [move];
  const heuristic = deps.heuristic;
  if (heuristic !== undefined && game.winner === undefined && isHeuristicSeat(member.seats, game)) {
    const burst = runBurst(game, member.seats, heuristic);
    game = burst.game;
    applied.push(...burst.moves);
  }
  try {
    await persistPosition(
      deps.s3,
      groupHash,
      gameNumber,
      position.version + 1,
      game,
      applied,
      position.raw,
    );
  } catch (error: unknown) {
    if (isPreconditionFailed(error)) return staleVersion();
    return internalError();
  }
  await wakeOthers(deps, member.seats, member.userHash, position.version + 1, groupHash, gameNumber);
  return jsonResult(200, { version: position.version + 1, groupHash, gameNumber });
};
