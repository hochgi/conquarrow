/**
 * P96 D1–D3 — the server's record of one game, for the browser route and the
 * agent door's `export` tool alike (one builder).
 *
 * @see docs/spec/game-management/game-management.md
 */

import type {
  ExportLogEntry,
  ExportReplyEntry,
  ExportSeat,
  GameExport,
  GameState,
  InviteSeat,
  Move,
  OnlineHttpResult,
  OnlineRequest,
} from '@conquarrow/contracts';
import { playerLetterLabel } from '@conquarrow/contracts';
import type { ObjectStore, OnlineApiDeps } from './api-types';
import { ensurePosition, openingConfig } from './game-handlers';
import { parseLogLine } from './game-log';
import { readGameMeta, requireMember } from './game-member';
import { summaryOf, turnsInLog } from './game-summary';
import { asRecord, boundAgentUserHash, boundUserHash } from './invite-record';
import { internalError, jsonResult } from './json-result';
import { gameLogKey } from './s3-keys';
import { getObject } from './store-io';
import { readProfileDisplayName } from './user-profile';

/** D1: a seat by kind (P107 D5: the invite's kinds) and name; an agent names its owner. Never a user hash. */
const exportSeatOf = async (
  s3: ObjectStore,
  seat: InviteSeat,
  index: number,
  player: string,
): Promise<ExportSeat> => {
  if (seat.kind === 'heuristic') return { seat: index, player, kind: 'heuristic', name: 'AI' };
  if (seat.kind === 'agent') {
    const owner = seat.userHash === undefined ? undefined : await readProfileDisplayName(s3, seat.userHash);
    return { seat: index, player, kind: 'agent', name: 'Agent', ...(owner === undefined ? {} : { owner }) };
  }
  const name = seat.userHash === undefined ? undefined : await readProfileDisplayName(s3, seat.userHash);
  return { seat: index, player, kind: 'human', name: name ?? playerLetterLabel(index) };
};

const numberList = (value: unknown): readonly number[] | undefined => {
  if (!Array.isArray(value)) return undefined;
  const list: number[] = [];
  for (const item of value) {
    if (typeof item !== 'number') return undefined;
    list.push(item);
  }
  return list;
};

/**
 * A stored reply line, or `undefined` when it is not one. P107 D4/D6: the seat
 * is the line's, else (pre-P107) the one nested in `agentReply`; `at`,
 * `resolved` and `offerVersion` are kept only when they have their written type.
 */
const replyOf = (raw: string): ExportReplyEntry | undefined => {
  let value: unknown;
  try {
    value = JSON.parse(raw) as unknown;
  } catch {
    return undefined;
  }
  const rec = asRecord(value);
  if (rec === undefined) return undefined;
  const reply = asRecord(rec['agentReply']);
  const v = rec['v'];
  if (reply === undefined || typeof v !== 'number') return undefined;
  const moves = numberList(reply['moves']);
  const endTurn = reply['endTurn'];
  if (moves === undefined || typeof endTurn !== 'boolean') return undefined;
  const { at, seat: lineSeat } = rec;
  const seat = typeof lineSeat === 'string' ? lineSeat : reply['seat'];
  const { why, plan, resolved, offerVersion } = reply;
  return {
    v,
    ...(typeof at === 'string' ? { at } : {}),
    ...(typeof seat === 'string' ? { seat } : {}),
    agentReply: {
      moves,
      ...(Array.isArray(resolved) ? { resolved: resolved as readonly Move[] } : {}),
      ...(typeof offerVersion === 'number' ? { offerVersion } : {}),
      endTurn,
      ...(typeof why === 'string' ? { why } : {}),
      ...(typeof plan === 'string' ? { plan } : {}),
    },
  };
};

/** The player ids the caller sits at — a human seat, or an agent seat they own. */
const callerPlayers = (seats: readonly InviteSeat[], game: GameState, callerHash: string): ReadonlySet<string> => {
  const own = new Set<string>();
  seats.forEach((seat, index) => {
    const player = game.players[index];
    if (player === undefined) return;
    if (boundUserHash(seat) === callerHash || boundAgentUserHash(seat) === callerHash) own.add(String(player));
  });
  return own;
};

/**
 * D1, D2: every move in order, and the reply records the caller may read —
 * their own seats' while the game is on, everyone's once it is won.
 */
const exportLog = (
  raw: string | undefined,
  own: ReadonlySet<string>,
  finished: boolean,
): { readonly log: readonly ExportLogEntry[]; readonly moves: readonly Move[]; readonly withheld: number } => {
  const log: ExportLogEntry[] = [];
  const moves: Move[] = [];
  let withheld = 0;
  for (const line of (raw ?? '').split('\n')) {
    if (line.length === 0) continue;
    const reply = replyOf(line);
    if (reply !== undefined) {
      const seat = reply.seat;
      if (finished || (seat !== undefined && own.has(seat))) log.push(reply);
      else withheld += 1;
      continue;
    }
    const parsed = parseLogLine(line);
    if (parsed === undefined) continue;
    moves.push(parsed.move);
    log.push(parsed);
  }
  return { log, moves, withheld };
};

/** D1–D3: the export as `callerHash` may read it, after the heal. */
export const buildGameExport = async (
  deps: OnlineApiDeps,
  groupHash: string,
  gameNumber: string,
  callerHash: string,
  seats: readonly InviteSeat[],
): Promise<GameExport | OnlineHttpResult> => {
  const position = await ensurePosition(deps, groupHash, gameNumber, seats);
  if ('statusCode' in position) return position;
  const meta = await readGameMeta(deps.s3, groupHash, gameNumber);
  if (meta === undefined) return internalError();
  const { game } = position;
  const rawLog = await getObject(deps.s3, gameLogKey(groupHash, gameNumber));
  const finished = game.winner !== undefined;
  const { log, moves, withheld } = exportLog(rawLog, callerPlayers(seats, game, callerHash), finished);
  const exportSeats: ExportSeat[] = [];
  for (let index = 0; index < seats.length; index += 1) {
    const seat = seats[index];
    const player = game.players[index];
    if (seat === undefined || player === undefined) continue;
    exportSeats.push(await exportSeatOf(deps.s3, seat, index, String(player)));
  }
  const summary = summaryOf(game, seats, rawLog);
  return {
    format: 'conquarrow-online-export',
    formatVersion: 2,
    groupHash,
    gameNumber,
    ...(meta.name === undefined ? {} : { name: meta.name }),
    ...(meta.startedAt === undefined ? {} : { startedAt: meta.startedAt }),
    ...(meta.lastActivityAt === undefined ? {} : { lastActivityAt: meta.lastActivityAt }),
    exportedAt: new Date(deps.clock()).toISOString(),
    config: openingConfig(seats.length),
    seats: exportSeats,
    version: position.version,
    activePlayer: String(game.activePlayer),
    ...(game.winner === undefined ? {} : { winner: String(game.winner) }),
    turns: turnsInLog(rawLog),
    ...(summary === undefined ? {} : { summary }),
    moves,
    log,
    withheldReplies: withheld,
  };
};

/** `GET /games/{g}/{n}/export` — any member (D1). */
export const handleGetExport = async (
  deps: OnlineApiDeps,
  request: OnlineRequest,
  groupHash: string,
  gameNumber: string,
): Promise<OnlineHttpResult> => {
  const member = await requireMember(deps, request, groupHash, gameNumber);
  if (!member.ok) return member.result;
  const built = await buildGameExport(deps, groupHash, gameNumber, member.userHash, member.seats);
  return 'statusCode' in built ? built : jsonResult(200, built);
};
