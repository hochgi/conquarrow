/**
 * The strip's words (P77, web adapter only).
 *
 * docs/spec/board-selection-model/board-selection-model.md — *Strip copy*.
 *
 * Pure: equal inputs give equal text. No clock, no randomness, and the lap
 * position is read in `compareArrows` order, never in the order `movable`
 * arrives in.
 */

import { compareArrows } from '@conquarrow/rules-core';
import type { ArrowId } from '@conquarrow/contracts';
import { REFUSAL_TEXT } from '../fx/present';
import type { Cursor } from './cursor';

/**
 * Row 1 of the strip: names the selected stack and its position in the
 * `Next stack` lap, or says nothing is selected.
 *
 * `heads` is the selected stack's head count on the live board; `movable` the
 * arrows `movableArrows` reports (any order).
 */
export const selectionLine = (opts: {
  readonly selected: Cursor;
  readonly heads: number;
  readonly movable: readonly ArrowId[];
}): string => {
  const { selected, heads, movable } = opts;
  const m = movable.length;
  if (selected === undefined) {
    return m === 0 ? 'No stack selected · nothing can move' : `No stack selected · ${String(m)} can move`;
  }
  const named = `Selected: ${String(heads)} on ${String(selected)}`;
  // The 1-based lap position: arrows strictly before `selected` in
  // `compareArrows` order, plus one — never the index in `movable`'s own order.
  const isMovable = movable.some((arrow) => compareArrows(arrow, selected) === 0);
  if (!isMovable) return `${named} · no move left · ${String(m)} can move`;
  const n = movable.filter((arrow) => compareArrows(arrow, selected) < 0).length + 1;
  return `${named} · ${String(n)} of ${String(m)}`;
};

/** Row 3's text when no refusal is showing: whether the turn passes by itself. */
export const turnStatus = (movableCount: number): string => {
  if (movableCount === 0) return 'Nothing can move · the turn passes by itself';
  const stacks = movableCount === 1 ? 'stack' : 'stacks';
  return `${String(movableCount)} ${stacks} can still move · End turn when done`;
};

/**
 * The strip's two text rows for the human seat, as App draws them.
 *
 * While input is locked (a seat thinking, a replay, a lesson card, match over)
 * the board is not the human seat's to drive, so neither row speaks for it — the
 * rows stay mounted and blank, except that a `board-busy` refusal still says why
 * the click did nothing.
 */
export const stripLines = (opts: {
  readonly locked: boolean;
  readonly selected: Cursor;
  readonly heads: number;
  readonly movable: readonly ArrowId[];
  /** The last refused click's sentence, if the last click was refused. */
  readonly refusal: string | undefined;
}): { readonly selection: string; readonly message: string } => {
  if (opts.locked) return { selection: '', message: opts.refusal ?? '' };
  // A board-busy note answers a click on a locked board; once the lock lifts it
  // is no longer true, even if no click has cleared it yet.
  const refusal = opts.refusal === REFUSAL_TEXT['board-busy'] ? undefined : opts.refusal;
  return {
    selection: selectionLine(opts),
    message: refusal ?? turnStatus(opts.movable.length),
  };
};

/** One Merge button per merge target, in `compareArrows` order; none while locked. */
export const mergeButtons = (
  merges: ReadonlySet<ArrowId> | undefined,
  locked: boolean,
): readonly ArrowId[] => (locked || merges === undefined ? [] : [...merges].toSorted(compareArrows));
