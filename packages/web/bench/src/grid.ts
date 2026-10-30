/**
 * The P79 grid: 2 players, the playtest config, `spawnerSeed ∈ {1,2,3}` ×
 * BYOK seated first or second = 6 cells. Fixed by the packet, not by a flag.
 */

import type { MatchConfig } from '@conquarrow/contracts';

export const GRID_SEEDS = [1, 2, 3] as const;

export type SeatOrder = 'first' | 'second';

export const SEAT_ORDERS: readonly SeatOrder[] = ['first', 'second'];

export interface Cell {
  /** `s<seed>-<first|second>`, e.g. `s2-second`. */
  readonly id: string;
  readonly seed: number;
  /** Where the BYOK chair sits in turn order. In `mirror` the heuristic drives it. */
  readonly byokSeat: SeatOrder;
}

export const cellId = (seed: number, byokSeat: SeatOrder): string =>
  `s${String(seed)}-${byokSeat}`;

export const gridCells = (): readonly Cell[] =>
  GRID_SEEDS.flatMap((seed) =>
    SEAT_ORDERS.map((byokSeat) => ({ id: cellId(seed, byokSeat), seed, byokSeat })),
  );

/** The 2026-10-29 playtest config with `playerCount: 2`. */
export const matchConfigFor = (seed: number): MatchConfig => ({
  dominationN: 5,
  R: 7,
  homeOffset: 5,
  playerCount: 2,
  spawnerSeed: seed,
});

/** Index into `state.players` of the BYOK chair. */
export const seatIndexOf = (order: SeatOrder): 0 | 1 => (order === 'first' ? 0 : 1);

/** Keep grid order; refuse an id that is not a cell rather than silently running fewer. */
export const selectCells = (
  cells: readonly Cell[],
  ids: readonly string[] | undefined,
): readonly Cell[] => {
  if (ids === undefined || ids.length === 0) return cells;
  const unknown = ids.filter((id) => !cells.some((cell) => cell.id === id));
  if (unknown.length > 0) {
    throw new Error(`unknown cell(s): ${unknown.join(', ')}; cells are ${cells.map((c) => c.id).join(', ')}`);
  }
  return cells.filter((cell) => ids.includes(cell.id));
};
