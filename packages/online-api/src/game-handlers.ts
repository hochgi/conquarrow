import type {
  GameState,
  InviteSeat,
  MatchConfig,
  Move,
  OnlineHttpResult,
  OnlineRequest,
} from '@conquarrow/contracts';
import {
  ContractViolation,
  DEFAULT_MATCH_CONFIG,
  endTurn,
  mintArrowId,
  step,
} from '@conquarrow/contracts';
import { makeMatch } from '@conquarrow/geometry-tiling';
import type { ObjectStore, OnlineApiDeps } from './api-types';
import { isPreconditionFailed } from './api-types';
import { activeSeat, advance, applyMove } from './game-advance';
import { persistEnvelope, parsePersistedEnvelope, type LastSubmit } from './game-snapshot';
import { stampLogLine } from './game-log';
import { gameOwner, requireMember } from './game-member';
import { summaryOf, turnsInLog } from './game-summary';
import { asRecord, boundAgentUserHash, boundUserHash } from './invite-record';
import {
  finished,
  forbidden,
  internalError,
  jsonResult,
  preconditionRequired,
  staleVersion,
  unprocessable,
} from './json-result';
import { notifyHumans } from './notify';
import { stampLibrarySummary, withSeatNames } from './library-listing';
import { gameLogKey, gameStateKey } from './s3-keys';
import { getObject, putObject } from './store-io';

const QUOTED_VERSION = /^"(\d+)"$/;
/** P95 D1: what a submit id may be. */
const SUBMIT_ID = /^[A-Za-z0-9_-]{1,64}$/;

export type LoadedPosition = {
  readonly version: number;
  readonly state: unknown;
  readonly game: GameState;
  readonly raw: string;
  readonly lastSubmit?: LastSubmit;
};

/** The config every online game opens with — and the one its export names (P96 D1). */
export const openingConfig = (playerCount: number): MatchConfig => ({
  ...DEFAULT_MATCH_CONFIG,
  playerCount,
});

const openingMatch = (playerCount: number): GameState => makeMatch(openingConfig(playerCount));

const parseQuotedVersion = (header: string): number | undefined => {
  const match = QUOTED_VERSION.exec(header);
  const digits = match?.[1];
  if (digits === undefined) return undefined;
  return Number.parseInt(digits, 10);
};

const loaded = (raw: string): LoadedPosition | undefined => {
  const parsed = parsePersistedEnvelope(raw);
  if (parsed === undefined) return undefined;
  return { ...parsed, raw };
};

export const loadPosition = async (
  s3: ObjectStore,
  groupHash: string,
  gameNumber: string,
): Promise<LoadedPosition | undefined> => {
  const raw = await getObject(s3, gameStateKey(groupHash, gameNumber));
  if (raw === undefined) return undefined;
  return loaded(raw);
};

const appendLog = (
  existing: string | undefined,
  version: number,
  moves: readonly Move[],
  extraLine?: string,
): string => {
  const stamped =
    moves.length === 0 ? '' : moves.map((move) => stampLogLine(version, move)).join('\n') + '\n';
  const extra = extraLine === undefined || extraLine === '' ? '' : `${extraLine}\n`;
  const lines = stamped + extra;
  if (lines === '') return existing ?? '';
  if (existing === undefined || existing === '') return lines;
  return existing.endsWith('\n') ? existing + lines : `${existing}\n${lines}`;
};

/** One persisted version (P49 log, P95 D1 lastSubmit, P96 D7 activity stamp). */
export interface PositionWrite {
  readonly version: number;
  readonly game: GameState;
  readonly logMoves: readonly Move[];
  /** The state body this write replaces; `undefined` for the opening. */
  readonly previousRaw: string | undefined;
  /** A non-move record (an agent reply) appended after the moves. */
  readonly extraLogLine?: string;
  readonly lastSubmit?: LastSubmit;
  /** The server clock (ms), stamped as the meta's `lastActivityAt`. */
  readonly now: number;
}

export const persistPosition = async (
  s3: ObjectStore,
  groupHash: string,
  gameNumber: string,
  write: PositionWrite,
): Promise<string> => {
  const { version, game, logMoves, previousRaw, extraLogLine, lastSubmit } = write;
  const body = persistEnvelope(version, game, lastSubmit);
  if (previousRaw === undefined) {
    await putObject(s3, gameStateKey(groupHash, gameNumber), body, { ifNoneMatch: '*' });
  } else {
    await putObject(s3, gameStateKey(groupHash, gameNumber), body, { ifMatch: previousRaw });
  }
  const logKey = gameLogKey(groupHash, gameNumber);
  const existingLog = await getObject(s3, logKey);
  const log = appendLog(existingLog, version, logMoves, extraLogLine);
  await putObject(s3, logKey, log);
  await stampLibrarySummary(s3, groupHash, gameNumber, game, {
    lastActivityAt: new Date(write.now).toISOString(),
    turns: turnsInLog(log),
  });
  return body;
};

/** P95 D6: every connection of every bound human; `also` adds an agent's owner. */
export const wakeAll = async (
  deps: OnlineApiDeps,
  seats: readonly InviteSeat[],
  version: number,
  groupHash: string,
  gameNumber: string,
  also?: string,
): Promise<void> => {
  try {
    await notifyHumans(
      deps.s3,
      deps.postToConnection,
      seats,
      { type: 'stateChanged', version, groupHash, gameNumber },
      also,
      deps.log,
    );
  } catch {
    return;
  }
};

const ensureOpening = async (
  deps: OnlineApiDeps,
  groupHash: string,
  gameNumber: string,
  seats: readonly InviteSeat[],
  also: string | undefined,
): Promise<LoadedPosition | OnlineHttpResult> => {
  const existing = await loadPosition(deps.s3, groupHash, gameNumber);
  if (existing !== undefined) return existing;
  const opened = advance(openingMatch(seats.length), seats, deps.heuristic, deps.clock);
  try {
    const raw = await persistPosition(deps.s3, groupHash, gameNumber, {
      version: 0,
      game: opened.game,
      logMoves: opened.moves,
      previousRaw: undefined,
      now: deps.clock(),
    });
    await wakeAll(deps, seats, 0, groupHash, gameNumber, also);
    return loaded(raw) ?? internalError();
  } catch (error: unknown) {
    if (!isPreconditionFailed(error)) throw error;
    const winner = await loadPosition(deps.s3, groupHash, gameNumber);
    return winner ?? internalError();
  }
};

/**
 * P95 D2: the heal. The position as the server must serve it: materialised,
 * then advanced past every seat the server plays. A heal that plays a move
 * persists it as the next version and wakes every human; one that loses the
 * conditional write serves the winner's position. `also` is an agent's owner
 * to wake beside the humans (P92).
 */
export const ensurePosition = async (
  deps: OnlineApiDeps,
  groupHash: string,
  gameNumber: string,
  seats: readonly InviteSeat[],
  also?: string,
): Promise<LoadedPosition | OnlineHttpResult> => {
  const position = await ensureOpening(deps, groupHash, gameNumber, seats, also);
  if ('statusCode' in position) return position;
  const healed = advance(position.game, seats, deps.heuristic, deps.clock);
  if (healed.moves.length === 0) return position;
  const version = position.version + 1;
  try {
    const raw = await persistPosition(deps.s3, groupHash, gameNumber, {
      version,
      game: healed.game,
      logMoves: healed.moves,
      previousRaw: position.raw,
      ...(position.lastSubmit === undefined ? {} : { lastSubmit: position.lastSubmit }),
      now: deps.clock(),
    });
    await wakeAll(deps, seats, version, groupHash, gameNumber, also);
    return loaded(raw) ?? internalError();
  } catch (error: unknown) {
    if (!isPreconditionFailed(error)) throw error;
    return (await loadPosition(deps.s3, groupHash, gameNumber)) ?? internalError();
  }
};

const parseMoveValue = (value: unknown): Move | undefined => {
  const rec = asRecord(value);
  if (rec === undefined) return undefined;
  const kind = rec['kind'];
  if (kind === 'endTurn') return endTurn();
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

type MoveBody = {
  readonly move: Move | undefined;
  /** `undefined` when absent; `false` when present and malformed (P95 D1). */
  readonly submitId: string | false | undefined;
};

const submitIdOf = (value: unknown): string | false | undefined => {
  if (value === undefined) return undefined;
  return typeof value === 'string' && SUBMIT_ID.test(value) ? value : false;
};

const parseMoveBody = (body: string | undefined): MoveBody => {
  let parsed: unknown;
  try {
    parsed = body === undefined ? undefined : (JSON.parse(body) as unknown);
  } catch {
    return { move: undefined, submitId: undefined };
  }
  const rec = asRecord(parsed);
  return { move: parseMoveValue(rec?.['move']), submitId: submitIdOf(rec?.['submitId']) };
};

/** P95 D1: the version this user's repeated submit produced, or `undefined`. */
const duplicateVersion = (
  position: LoadedPosition,
  submitId: string | undefined,
  userHash: string,
): number | undefined => {
  const last = position.lastSubmit;
  if (submitId === undefined || last?.id !== submitId || last.userHash !== userHash) {
    return undefined;
  }
  return last.version;
};

const duplicate = (version: number, groupHash: string, gameNumber: string): OnlineHttpResult =>
  jsonResult(200, { version, groupHash, gameNumber, duplicate: true });

export const handleGetGame = async (
  deps: OnlineApiDeps,
  request: OnlineRequest,
  groupHash: string,
  gameNumber: string,
): Promise<OnlineHttpResult> => {
  const member = await requireMember(deps, request, groupHash, gameNumber);
  if (!member.ok) return member.result;
  const position = await ensurePosition(deps, groupHash, gameNumber, member.seats);
  if ('statusCode' in position) return position;
  const body: Record<string, unknown> = {
    version: position.version,
    state: position.state,
    seats: await withSeatNames(deps.s3, member.seats),
    ...(member.meta.name === undefined ? {} : { name: member.meta.name }),
    owner: (await gameOwner(deps.s3, member.meta)) === member.userHash,
  };
  if (position.game.winner !== undefined) {
    const log = await getObject(deps.s3, gameLogKey(groupHash, gameNumber));
    body['summary'] = summaryOf(position.game, member.seats, log);
  }
  return jsonResult(200, body);
};

/** P95 D5: the poll's small answer, after the heal. */
export const handleGetVersion = async (
  deps: OnlineApiDeps,
  request: OnlineRequest,
  groupHash: string,
  gameNumber: string,
): Promise<OnlineHttpResult> => {
  const member = await requireMember(deps, request, groupHash, gameNumber);
  if (!member.ok) return member.result;
  const position = await ensurePosition(deps, groupHash, gameNumber, member.seats);
  if ('statusCode' in position) return position;
  const { game } = position;
  return jsonResult(200, {
    version: position.version,
    activePlayer: String(game.activePlayer),
    ...(game.winner === undefined ? {} : { winner: String(game.winner) }),
  });
};

/** P95 D3: 403, naming an agent seat its owner's browser may not move. */
const notYourSeat = (
  seats: readonly InviteSeat[],
  game: GameState,
  userHash: string,
): OnlineHttpResult | undefined => {
  const seat = activeSeat(seats, game);
  if (seat !== undefined && boundUserHash(seat) === userHash) return undefined;
  if (seat !== undefined && boundAgentUserHash(seat) === userHash) {
    return jsonResult(403, { error: 'forbidden', reason: 'agent-seat' });
  }
  return forbidden();
};

/** The move and what the server plays after it, or the 422 a refused move earns. */
const applySubmitted = (
  deps: OnlineApiDeps,
  game: GameState,
  seats: readonly InviteSeat[],
  move: Move,
): { readonly game: GameState; readonly moves: readonly Move[] } | undefined => {
  let after: GameState;
  try {
    after = applyMove(game, move);
  } catch (error: unknown) {
    if (error instanceof ContractViolation) return undefined;
    throw error;
  }
  const advanced = advance(after, seats, deps.heuristic, deps.clock);
  return { game: advanced.game, moves: [move, ...advanced.moves] };
};

/** A lost write: a duplicate when the winner was this very submit, else 412. */
const afterLostRace = async (
  deps: OnlineApiDeps,
  groupHash: string,
  gameNumber: string,
  submitId: string | undefined,
  userHash: string,
): Promise<OnlineHttpResult> => {
  const winner = await loadPosition(deps.s3, groupHash, gameNumber);
  const repeated = winner === undefined ? undefined : duplicateVersion(winner, submitId, userHash);
  return repeated === undefined ? staleVersion() : duplicate(repeated, groupHash, gameNumber);
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
  const body = parseMoveBody(request.body);
  if (body.submitId === false) return unprocessable();
  const submitId = body.submitId;
  const position = await ensurePosition(deps, groupHash, gameNumber, member.seats);
  if ('statusCode' in position) return position;
  const repeated = duplicateVersion(position, submitId, member.userHash);
  if (repeated !== undefined) return duplicate(repeated, groupHash, gameNumber);
  if (parseQuotedVersion(ifMatch) !== position.version) return staleVersion();
  if (position.game.winner !== undefined) return finished();
  const refused = notYourSeat(member.seats, position.game, member.userHash);
  if (refused !== undefined) return refused;
  if (body.move === undefined) return unprocessable();
  const applied = applySubmitted(deps, position.game, member.seats, body.move);
  if (applied === undefined) return unprocessable();
  const version = position.version + 1;
  const lastSubmit =
    submitId === undefined
      ? position.lastSubmit
      : { id: submitId, userHash: member.userHash, version };
  try {
    await persistPosition(deps.s3, groupHash, gameNumber, {
      version,
      game: applied.game,
      logMoves: applied.moves,
      previousRaw: position.raw,
      ...(lastSubmit === undefined ? {} : { lastSubmit }),
      now: deps.clock(),
    });
  } catch (error: unknown) {
    if (isPreconditionFailed(error)) {
      return afterLostRace(deps, groupHash, gameNumber, submitId, member.userHash);
    }
    return internalError();
  }
  await wakeAll(deps, member.seats, version, groupHash, gameNumber);
  return jsonResult(200, { version, groupHash, gameNumber });
};
