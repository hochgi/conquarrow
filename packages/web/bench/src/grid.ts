/**
 * The P79 grid: 2 players, the playtest config, `spawnerSeed ∈ {1,2,3}` ×
 * BYOK seated first or second = 6 cells. Fixed by the packet, not by a flag.
 * P82 adds the 3-player variant, used only by its 3-player check: the same
 * seeds × BYOK seated first, second or third = 9 cells, ids prefixed `p3-`.
 */

import type { MatchConfig } from '@conquarrow/contracts';

export const GRID_SEEDS = [1, 2, 3] as const;

export type SeatOrder = 'first' | 'second' | 'third';

export const SEAT_ORDERS: readonly SeatOrder[] = ['first', 'second'];

export type PlayerCount = 2 | 3;

export const PLAYER_COUNTS: readonly PlayerCount[] = [2, 3];

const seatOrdersFor = (players: PlayerCount): readonly SeatOrder[] =>
  players === 2 ? SEAT_ORDERS : [...SEAT_ORDERS, 'third'];

export interface Cell {
  /** `s<seed>-<first|second>`, e.g. `s2-second`; 3 players: `p3-s2-third`. */
  readonly id: string;
  readonly seed: number;
  /** Where the BYOK chair sits in turn order. In `mirror` the heuristic drives it. */
  readonly byokSeat: SeatOrder;
  /** P78's grid varies the board; absent means {@link matchConfigFor}`(seed)`. */
  readonly config?: MatchConfig;
}

export const cellId = (seed: number, byokSeat: SeatOrder, players: PlayerCount = 2): string =>
  `${players === 2 ? '' : `p${String(players)}-`}s${String(seed)}-${byokSeat}`;

/** The 2-player grid keeps P79's ids and configs unchanged (no `config` on the cell). */
export const gridCells = (players: PlayerCount = 2): readonly Cell[] =>
  GRID_SEEDS.flatMap((seed) =>
    seatOrdersFor(players).map((byokSeat) => ({
      id: cellId(seed, byokSeat, players),
      seed,
      byokSeat,
      ...(players === 2 ? {} : { config: matchConfigFor(seed, players) }),
    })),
  );

/** The 2026-10-29 playtest config, 2 players unless told otherwise. */
export const matchConfigFor = (seed: number, players: PlayerCount = 2): MatchConfig => ({
  dominationN: 5,
  R: 7,
  homeOffset: 5,
  playerCount: players,
  spawnerSeed: seed,
});

export const cellConfig = (cell: Cell): MatchConfig => cell.config ?? matchConfigFor(cell.seed);

/** Index into `state.players` of the BYOK chair. */
export const seatIndexOf = (order: SeatOrder): 0 | 1 | 2 =>
  order === 'first' ? 0 : order === 'second' ? 1 : 2;

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
