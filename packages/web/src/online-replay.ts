/**
 * Online move-log replay — pure decisions for a remote turn played out move by
 * move (P49). Web adapter only: no game rule is read, written, or implied.
 *
 * Pure — no clock, no fetch, no DOM. The adapter does the I/O and App owns the
 * drain loop; every decision either of them consumes lives here.
 *
 * @see docs/spec/online-move-log-replay/online-move-log-replay.md
 */

import type { GameState, Move, ReplayBatch } from '@conquarrow/contracts';
import { arrowsOfMove } from './spectate';

/** The `{from,to,gap,moves}` body of `GET /games/:g/:n/log?since=N`. */
export interface LogWindow {
  readonly from: number;
  readonly to: number;
  readonly gap: boolean;
  readonly moves: readonly Move[];
}

/**
 * What a wake asks the client to do (D4). `install` shows the snapshot and
 * replays nothing; `replay` queues a batch; `nothing` is a wake for a version
 * already displayed.
 */
export type ReplayPlan =
  | { readonly kind: 'install'; readonly version: number }
  | { readonly kind: 'replay'; readonly batch: ReplayBatch }
  | { readonly kind: 'nothing' };

/** `since` is required — there is no spelling of this route that pulls a match (D1). */
export const logPath = (groupHash: string, gameNumber: string, since: number): string =>
  `/games/${groupHash}/${gameNumber}/log?since=${String(since)}`;

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;

const parseMove = (value: unknown): Move | undefined => {
  const rec = asRecord(value);
  const kind = rec?.['kind'];
  if (kind !== 'step' && kind !== 'skip' && kind !== 'endTurn') return undefined;
  return value as Move;
};

/** Parse a log body. Anything that is not a well-formed window is `undefined`. */
export const parseLogWindow = (raw: unknown): LogWindow | undefined => {
  const rec = asRecord(raw);
  if (rec === undefined) return undefined;
  const from = rec['from'];
  const to = rec['to'];
  const gap = rec['gap'];
  const rawMoves = rec['moves'];
  if (typeof from !== 'number' || typeof to !== 'number' || typeof gap !== 'boolean') {
    return undefined;
  }
  if (!Array.isArray(rawMoves)) return undefined;
  const moves: Move[] = [];
  for (const value of rawMoves as readonly unknown[]) {
    const move = parseMove(value);
    if (move === undefined) return undefined;
    moves.push(move);
  }
  return { from, to, gap, moves };
};

/**
 * D4. No baseline, a gap, or an unusable window (`undefined` — the request
 * failed) installs the snapshot; a baseline behind a contiguous window replays;
 * a baseline at or past `to` shows nothing.
 */
export const planFromWake = (args: {
  readonly baseline: number | undefined;
  readonly to: number;
  readonly window: LogWindow | undefined;
}): ReplayPlan => {
  const { baseline, to, window } = args;
  if (baseline === undefined) return { kind: 'install', version: to };
  if (baseline >= to) return { kind: 'nothing' };
  if (window === undefined || window.gap) return { kind: 'install', version: to };
  return { kind: 'replay', batch: { from: window.from, to: window.to, moves: window.moves } };
};

/**
 * The moves to drive through the commit path, in order, for a queue of batches:
 * every move of every batch, none dropped, arrival order preserved (EARS 7, 9).
 */
export const commitSequence = (batches: readonly ReplayBatch[]): readonly Move[] =>
  batches.flatMap((batch) => [...batch.moves]);

/** The replayed moves that earn a camera hop — a step shows two arrows, a pass none. */
export const hopMoves = (moves: readonly Move[]): readonly Move[] =>
  moves.filter((move) => arrowsOfMove(move).length > 0);

/** The camera's replay window is open while any replayed move is still to be shown. */
export const inReplayWindow = (args: {
  readonly playing: boolean;
  readonly pending: number;
}): boolean => args.playing || args.pending > 0;

const quote = (value: string): string => JSON.stringify(value);

const sortedPairs = (
  entries: Iterable<readonly [unknown, unknown]>,
  value: (v: unknown) => string,
): string =>
  [...entries]
    .map(([k, v]) => `${quote(String(k))}:${value(v)}`)
    .toSorted()
    .join(',');

const groupDigest = (value: unknown): string => {
  const g = value as { owner: unknown; heads: number; spent: number; speedOverride?: number };
  const override = g.speedOverride === undefined ? 'n' : String(g.speedOverride);
  return `${quote(String(g.owner))}/${String(g.heads)}/${String(g.spent)}/${override}`;
};

const setDigest = (value: unknown): string =>
  `[${[...(value as ReadonlySet<unknown>)].map(String).toSorted().join(',')}]`;

const rationalDigest = (value: unknown): string => {
  const r = value as { num: unknown; den: unknown };
  return `${String(r.num)}/${String(r.den)}`;
};

const spawnerDigest = (value: unknown): string => {
  const s = value as { force: unknown; phase: number };
  return `${rationalDigest(s.force)}@${String(s.phase)}`;
};

/**
 * A deterministic digest of a position. Order-independent over the engine's
 * maps and sets — a digest that read `Set` order would itself be the defect
 * this comparison exists to catch.
 */
export const stateDigest = (state: GameState): string =>
  [
    `players:${state.players.map(String).join(',')}`,
    `active:${String(state.activePlayer)}`,
    `winner:${state.winner === undefined ? 'none' : String(state.winner)}`,
    `dominationN:${String(state.dominationN)}`,
    `groups:{${sortedPairs(state.groups, groupDigest)}}`,
    `trails:{${sortedPairs(state.trails, setDigest)}}`,
    `territory:{${sortedPairs(state.territory, (v) => quote(String(v)))}}`,
    `accumulators:{${sortedPairs(state.accumulators, rationalDigest)}}`,
    `spawners:{${sortedPairs(state.spawners, spawnerDigest)}}`,
    `starvation:{${sortedPairs(state.starvationStreaks, (v) => String(v))}}`,
  ].join('|');

/**
 * D5. A replayed state that disagrees with the authoritative snapshot at the
 * same version yields a report naming group, game and version; agreement yields
 * `undefined`. Nothing is mitigated either way.
 */
export const divergenceReport = (args: {
  readonly groupHash: string;
  readonly gameNumber: string;
  readonly version: number;
  readonly replayed: GameState;
  readonly snapshot: GameState;
}): string | undefined => {
  const replayed = stateDigest(args.replayed);
  const snapshot = stateDigest(args.snapshot);
  if (replayed === snapshot) return undefined;
  return [
    'conquarrow: replayed state diverges from the authoritative snapshot',
    `group ${args.groupHash}`,
    `game ${args.gameNumber}`,
    `version ${String(args.version)}`,
    `replayed ${replayed}`,
    `snapshot ${snapshot}`,
  ].join(' — ');
};
