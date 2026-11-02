/**
 * P83 bench hygiene support — the `matches` record's `byokTurns`.
 * docs/spec/byok-opening-horizon/byok-opening-horizon.md, Decision 10, I9.
 *
 * Scripted `FetchLike` only: no network, no key, no real model call.
 */

import { makeMatch } from '@conquarrow/geometry-tiling';
import { PLAN_CAP } from '../../src/byokBot';
import { rules } from '../src/board';
import { cellConfig, cellId, type Cell } from '../src/grid';
import type { MatchRecord } from '../src/match';
import { parseMove } from '../src/moves';

export const cell = (seed: number, byokSeat: 'first' | 'second'): Cell => ({
  id: cellId(seed, byokSeat),
  seed,
  byokSeat,
});

/** A raw reply body: any JSON object, so a test can omit a key or give it a non-string. */
export const reply = (body: Readonly<Record<string, unknown>>): string => JSON.stringify(body);

/** The adapter's plan sanitiser, written out from Decision 10: one line, at most `PLAN_CAP`. */
export const sanitised = (text: string): string => {
  const line = text.replace(/[\n\r]+/g, ' ').trim();
  return line.length <= PLAN_CAP ? line : line.slice(0, PLAN_CAP);
};

/**
 * Replay a record's moves and return the index of every move that starts one of
 * the BYOK chair's seat-turns: the chair is to move, and it is the match's first
 * move or follows an `endTurn`.
 */
export const byokTurnStarts = (record: MatchRecord): number[] => {
  let at = makeMatch(cellConfig(record.cell));
  const starts: number[] = [];
  for (const [i, raw] of record.moves.entries()) {
    const move = parseMove(raw, `move ${String(i)}`);
    const fresh = i === 0 || record.moves[i - 1]?.kind === 'endTurn';
    if (fresh && String(at.activePlayer) === record.byokPlayer) starts.push(i);
    at = rules.apply(at, move);
  }
  return starts;
};

/** I9's reply-text shape: `null`, or one line of at most `PLAN_CAP` characters. */
export const isRecordedText = (text: unknown): boolean =>
  text === null || (typeof text === 'string' && !/[\n\r]/.test(text) && text.length <= PLAN_CAP);
