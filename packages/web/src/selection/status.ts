/**
 * The strip's words (P77, web adapter only).
 *
 * docs/spec/board-selection-model/board-selection-model.md — *Strip copy*.
 *
 * Pure: equal inputs give equal text. No clock, no randomness, and the lap
 * position is read in `compareArrows` order, never in the order `movable`
 * arrives in.
 */

import type { ArrowId } from '@conquarrow/contracts';
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
  throw new Error(
    `not implemented: selectionLine(${String(opts.selected)}, ${String(opts.heads)}, ${String(opts.movable.length)}) (P77)`,
  );
};

/** Row 3's text when no refusal is showing: whether the turn passes by itself. */
export const turnStatus = (movableCount: number): string => {
  throw new Error(`not implemented: turnStatus(${String(movableCount)}) (P77)`);
};
