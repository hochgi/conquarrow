/**
 * `GET /games/{groupHash}/{gameNumber}/log?since=N` — moves since a version (P49).
 *
 * @see docs/spec/online-move-log-replay/online-move-log-replay.md
 * @see docs/adr/0002-cheap-async-online.md
 */

import type { ExportMoveEntry, LogEvent, Move, OnlineHttpResult, OnlineRequest } from '@conquarrow/contracts';
import type { OnlineApiDeps } from './api-types';
import { parsePersistedEnvelope } from './game-snapshot';
import { requireMember } from './game-member';
import { asRecord } from './invite-record';
import { jsonResult, unprocessable } from './json-result';
import { gameLogKey, gameStateKey } from './s3-keys';
import { getObject } from './store-io';

/**
 * One persisted move line as read back. `v` is absent before P49; `at`, `seat`,
 * `by` and `events` are absent before P107 (match-log-v2 D3, D6).
 */
export type LogLine = ExportMoveEntry;

/** P107 D3: one applied move with what its line records beside `v`. */
export interface LoggedMove {
  readonly move: Move;
  /** Server clock (ISO 8601) read right after the move was applied. */
  readonly at: string;
  /** The player id whose turn it was. */
  readonly seat: string;
  /** `server` when the advance chose the move; absent (`undefined`) otherwise. */
  readonly by: 'server' | undefined;
  readonly events: readonly LogEvent[];
}

/** A plain non-negative decimal integer — the only `since` this route accepts. */
const SINCE = /^(?:0|[1-9][0-9]*)$/;

/**
 * `{"v":N,"at":…,"seat":…,"by"?:"server","move":{…},"events":[…]}` — P107 D3.
 * An absent `by` is dropped by `JSON.stringify` (it is `undefined`).
 */
export const stampLogLine = (version: number, entry: LoggedMove): string =>
  JSON.stringify({
    v: version,
    at: entry.at,
    seat: entry.seat,
    by: entry.by,
    move: entry.move,
    events: entry.events,
  });

/** The P107 fields a stored line carries, each kept only when it has its written type. */
const v2Fields = (rec: Readonly<Record<string, unknown>>): Omit<ExportMoveEntry, 'v' | 'move'> => {
  const { at, seat, by, events } = rec;
  return {
    ...(typeof at === 'string' ? { at } : {}),
    ...(typeof seat === 'string' ? { seat } : {}),
    ...(by === 'server' ? { by } : {}),
    ...(Array.isArray(events) ? { events: events as readonly LogEvent[] } : {}),
  };
};

/** Parse one `log.jsonl` line. Unstamped lines parse with `v` absent. */
export const parseLogLine = (raw: string): LogLine | undefined => {
  let value: unknown;
  try {
    value = JSON.parse(raw) as unknown;
  } catch {
    return undefined;
  }
  const rec = asRecord(value);
  if (rec === undefined) return undefined;
  const move = rec['move'];
  // A playtest record is not a move. Skipping it keeps the version window intact.
  if (move === undefined && rec['agentReply'] !== undefined) return undefined;
  // Pre-P49: the line *is* the move, with no envelope around it.
  if (move === undefined) return { move: value as Move };
  const inner = asRecord(move);
  if (inner === undefined) return undefined;
  const v = rec['v'];
  // `Number.isInteger` is false for every non-number, so it alone decides the stamp.
  return { ...(Number.isInteger(v) ? { v: v as number } : {}), ...v2Fields(rec), move: move as Move };
};

const parseLogLines = (raw: string | undefined): readonly LogLine[] => {
  if (raw === undefined || raw === '') return [];
  const out: LogLine[] = [];
  for (const line of raw.split('\n')) {
    if (line.length === 0) continue;
    const parsed = parseLogLine(line);
    if (parsed !== undefined) out.push(parsed);
  }
  return out;
};

const GAP = { gap: true, moves: [] as readonly Move[] } as const;

/**
 * The moves whose stamped version lies in `(from, to]`, in persisted order, or
 * a gap when the window cannot be supplied contiguously from stamped lines.
 *
 * A version with no stamped line in the file is a hole, not an empty batch: the
 * route cannot tell those apart, and guessing is exactly what D2 forbids. An
 * unstamped (pre-P49) line is never served and never satisfies a version.
 */
export const windowOfLog = (
  raw: string | undefined,
  from: number,
  to: number,
): { readonly gap: boolean; readonly moves: readonly Move[] } => {
  if (to <= from) return { gap: false, moves: [] };
  const moves: Move[] = [];
  const seen = new Set<number>();
  let previous = from;
  for (const line of parseLogLines(raw)) {
    const v = line.v;
    if (v === undefined || v <= from || v > to) continue;
    // Out-of-order stamps mean the file is not the ordered log the route promises.
    if (v < previous) return GAP;
    previous = v;
    seen.add(v);
    moves.push(line.move);
  }
  for (let v = from + 1; v <= to; v += 1) {
    if (!seen.has(v)) return GAP;
  }
  return { gap: false, moves };
};

const parseSince = (request: OnlineRequest): number | undefined => {
  const raw = request.query?.['since'];
  if (raw === undefined || !SINCE.test(raw)) return undefined;
  return Number.parseInt(raw, 10);
};

const currentVersion = async (
  deps: OnlineApiDeps,
  groupHash: string,
  gameNumber: string,
): Promise<number> => {
  const raw = await getObject(deps.s3, gameStateKey(groupHash, gameNumber));
  const parsed = raw === undefined ? undefined : parsePersistedEnvelope(raw);
  return parsed?.version ?? 0;
};

export const handleGetLog = async (
  deps: OnlineApiDeps,
  request: OnlineRequest,
  groupHash: string,
  gameNumber: string,
): Promise<OnlineHttpResult> => {
  const member = await requireMember(deps, request, groupHash, gameNumber);
  if (!member.ok) return member.result;
  const since = parseSince(request);
  if (since === undefined) return unprocessable();
  const to = await currentVersion(deps, groupHash, gameNumber);
  const raw = await getObject(deps.s3, gameLogKey(groupHash, gameNumber));
  const window = windowOfLog(raw, since, to);
  return jsonResult(200, { from: since, to, gap: window.gap, moves: window.moves });
};
