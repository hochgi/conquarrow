/**
 * Shared fixtures for P70 convert-spent rules tests.
 *
 * Convert is observed through apply / legalMoves. Boards are the P02 fixtures
 * (claimed-land convert) or the tiling (a real closure).
 */

import { step } from '@conquarrow/contracts';
import type { GameState, MergeOverride } from '@conquarrow/contracts';
import type { ArrowId } from '@conquarrow/contracts';
import {
  A,
  B,
  MINIMAL_DIAMETER,
  aRunFromHome,
  allArrows,
  anArrow,
  anExitFrom,
  arrowAt,
  exitsFrom,
  onTiling,
  owned,
  ownerOf,
  pick,
  stateOf,
} from './support';
import type { Table } from './support';

export const applyConvert = (
  table: Table,
  before: GameState,
  from: ArrowId,
  exit: ArrowId,
): GameState => table.rules.apply(before, step(from, exit, 1));

/**
 * B's unprotected stack already on A's land, plus an A mover that can step
 * without landing on it. Conversion runs on that step (P07).
 */
export const aLandConvert = (
  table: Table,
  heads: number,
  victim: { readonly spent?: number; readonly speedOverride?: MergeOverride } = {},
): {
  readonly converted: ArrowId;
  readonly mover: ArrowId;
  readonly exit: ArrowId;
  readonly before: GameState;
} => {
  const converted = anArrow(table.geometry);
  const mover = anExitFrom(table.geometry, converted);
  const exit = pick(
    exitsFrom(table.geometry, mover).filter((arrow) => arrow !== converted),
    0,
  );
  const before = stateOf(
    [
      {
        arrow: converted,
        owner: B,
        heads,
        ...(victim.spent === undefined ? {} : { spent: victim.spent }),
        ...(victim.speedOverride === undefined ? {} : { speedOverride: victim.speedOverride }),
      },
      { arrow: mover, owner: A, heads: 1 },
    ],
    A,
    {
      territory: [
        { arrow: converted, owner: A },
        { arrow: mover, owner: A },
        { arrow: exit, owner: A },
      ],
    },
  );
  const trail = before.trails.get(B);
  const protectedTrail =
    trail?.has(converted) === true && table.rules.anchorGrade(before, converted, B) === 'territory';
  if (protectedTrail) throw new Error('setup: victim must not be territory-grade');
  return { converted, mover, exit, before };
};

/** A run that lands, converting B's stack on the claimed stretch. */
export const aClosureConvert = (
  heads: number,
  victim: { readonly spent?: number; readonly speedOverride?: MergeOverride } = {},
): {
  readonly table: ReturnType<typeof onTiling>;
  readonly occupied: ArrowId;
  readonly last: ArrowId;
  readonly landing: ArrowId;
  readonly before: GameState;
} => {
  const table = onTiling();
  const { home, run } = aRunFromHome(table.geometry, 3);
  const occupied = arrowAt(run, 0);
  const last = arrowAt(run, 2);
  const landing = anExitFrom(table.geometry, last);
  const before = stateOf(
    [
      { arrow: last, owner: A, heads: 1 },
      {
        arrow: occupied,
        owner: B,
        heads,
        ...(victim.spent === undefined ? {} : { spent: victim.spent }),
        ...(victim.speedOverride === undefined ? {} : { speedOverride: victim.speedOverride }),
      },
    ],
    A,
    { trail: { A: [...run] }, territory: owned([home, landing], A) },
  );
  return { table, occupied, last, landing, before };
};

/** A grain neighbour that can step onto `dest`, not in `avoid`. */
export const anArrivalOnto = (
  table: Table,
  dest: ArrowId,
  avoid: readonly ArrowId[],
): ArrowId => {
  const blocked = new Set(avoid.map(String));
  for (const from of allArrows(table.geometry, 2)) {
    if (blocked.has(String(from))) continue;
    if (exitsFrom(table.geometry, from).includes(dest)) return from;
  }
  throw new Error(`setup: no arrival onto ${String(dest)}`);
};

export const anArrowAwayFrom = (table: Table, avoid: readonly ArrowId[]): ArrowId => {
  const blocked = new Set(avoid.map(String));
  for (const arrow of allArrows(table.geometry, MINIMAL_DIAMETER + 1)) {
    if (!blocked.has(String(arrow))) return arrow;
  }
  throw new Error('setup: no arrow away from the avoid set');
};

export const closeAround = (
  setup: ReturnType<typeof aClosureConvert>,
): GameState => {
  const after = applyConvert(setup.table, setup.before, setup.last, setup.landing);
  if (ownerOf(after, setup.occupied) !== A) {
    throw new Error('setup: closure did not convert the occupied arrow');
  }
  return after;
};
