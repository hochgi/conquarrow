/**
 * Moves as the match log stores them — `{kind:'step',from,exit,count}` or
 * `{kind:'endTurn'}`. Results files carry a match's moves in this shape so a
 * benched match replays like any playtest log (P10).
 */

import { endTurn, mintArrowId, step } from '@conquarrow/contracts';
import type { Move } from '@conquarrow/contracts';

export type SerializedMove =
  | { readonly kind: 'step'; readonly from: string; readonly exit: string; readonly count: number }
  | { readonly kind: 'endTurn' };

export const serializeMove = (move: Move): SerializedMove =>
  move.kind === 'step'
    ? { kind: 'step', from: String(move.from), exit: String(move.exit), count: move.count }
    : { kind: 'endTurn' };

const field = (rec: Record<string, unknown>, key: string): unknown => rec[key];

/** Strict: a malformed row is a corpus error, never a skipped move. */
export const parseMove = (raw: unknown, where: string): Move => {
  if (typeof raw !== 'object' || raw === null) throw new Error(`${where}: move is not an object`);
  const rec = raw as Record<string, unknown>;
  const kind = field(rec, 'kind');
  if (kind === 'endTurn') return endTurn();
  const from = field(rec, 'from');
  const exit = field(rec, 'exit');
  const count = field(rec, 'count');
  if (kind !== 'step' || typeof from !== 'string' || typeof exit !== 'string' || typeof count !== 'number') {
    throw new Error(`${where}: not a step or endTurn move`);
  }
  return step(mintArrowId(from), mintArrowId(exit), count);
};
