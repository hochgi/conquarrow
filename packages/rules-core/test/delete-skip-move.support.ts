/**
 * Shared fixtures for P51 — the deletion of `SkipMove`.
 *
 * Nothing here imports `skip`: the point of the packet is that the constructor
 * goes, so a helper that needed it would stop compiling the moment phase 3
 * lands. Where a skip-*shaped* value is needed (a stale persisted record), it is
 * built as data and cast at the boundary, which is exactly how such a value
 * would arrive from a log.
 */

import type { ArrowId, GameState, Move } from '@conquarrow/contracts';
import { A, B, allArrows, exitsFrom, onBoard, stateOf } from './support';
import type { Table } from './support';
import { MINIMAL_DIAMETER } from './support';

/** A persisted record naming the deleted kind, as it would arrive from a log. */
export const skipShaped = (from: ArrowId): Move =>
  ({ kind: 'skip', from }) as unknown as Move;

/** Does a move name this arrow? True for a step from it; a skip named one too. */
export const namesArrow = (move: Move, arrow: ArrowId): boolean =>
  'from' in move && move.from === arrow;

/**
 * A stack with allowance whose every exit is unlandable.
 *
 * A lone head cannot attack: an attacking step must leave at least one head
 * behind (`maxCount = heads - 1`), so a single head facing an enemy on every
 * exit has allowance and no landable exit at all. Before this packet the offer
 * held exactly `skip(arrow)` for it; after, it holds nothing naming it.
 */
export const stackWithNoLandableExit = (): {
  readonly table: Table;
  readonly arrow: ArrowId;
  readonly state: GameState;
} => {
  const table = onBoard();
  const arrow = allArrows(table.geometry, MINIMAL_DIAMETER)[0];
  if (arrow === undefined) throw new Error('setup: the fixture board has no arrows');
  return { table, arrow, state: blockedStateOn(table, arrow) };
};

/** The same construction, for any arrow of the board — the property's generator. */
export const blockedStateOn = (table: Table, arrow: ArrowId): GameState =>
  stateOf([
    { arrow, owner: A, heads: 1 },
    ...exitsFrom(table.geometry, arrow).map((exit) => ({ arrow: exit, owner: B, heads: 2 })),
  ]);

/**
 * Every arrow of the fixture board, enumerated in port order. Deterministic by
 * construction — no seed, no shuffle (ADR 0001).
 */
export const everyArrow = (table: Table): readonly ArrowId[] =>
  allArrows(table.geometry, MINIMAL_DIAMETER);
