/**
 * Online game-over standings (P102 D7). A view of the server summary, or the fallback.
 * Pure: no clock, no DOM, no I/O. Rendering does not sort, label, or decide fallback.
 *
 * @see docs/spec/lost-seat-standings/lost-seat-standings.md
 */

import type { GameSummary, InviteSeat, SeatStanding } from '@conquarrow/contracts';
import { labelForChair } from './seatLabel';

export interface StandingsRow {
  readonly letter: string;
  readonly territory: number;
  readonly shares: number;
  readonly heads: number;
  readonly lost: boolean;
  readonly winner: boolean;
  readonly label: string;
  readonly you: boolean;
  /** `winner, lost` if both, else `winner`, else `lost`, else `''`. */
  readonly marker: string;
}

export type StandingsView =
  | { readonly kind: 'fallback' }
  | {
      readonly kind: 'table';
      readonly wonOnTurn: string;
      readonly rows: readonly StandingsRow[];
    };

const markerOf = (winner: boolean, lost: boolean): string => {
  if (winner && lost) return 'winner, lost';
  if (winner) return 'winner';
  if (lost) return 'lost';
  return '';
};

/** Built before sorting. Chair is `seats[standing.seat]`, not the row index. */
const rowOf = (
  summary: GameSummary,
  standing: SeatStanding,
  seats: readonly InviteSeat[] | undefined,
  callerUserHash: string | undefined,
): StandingsRow => {
  const chair = seats?.[standing.seat];
  const label = labelForChair({
    letter: standing.player,
    chair,
    kindHint: standing.kind,
    userHash: callerUserHash,
  });
  const winner = standing.player === summary.winner;
  return {
    letter: standing.player,
    territory: standing.territory,
    shares: standing.shares,
    heads: standing.heads,
    lost: standing.lost,
    winner,
    label,
    you: label === 'you',
    marker: markerOf(winner, standing.lost),
  };
};

/** Winners first, then the rest. Each group keeps the order it was built in. */
const winnersFirst = (rows: readonly StandingsRow[]): readonly StandingsRow[] => [
  ...rows.filter((row) => row.winner),
  ...rows.filter((row) => !row.winner),
];

/**
 * `undefined` summary is the fallback. No rows are invented from the rules state.
 * Otherwise a table: winners first, then the rest, each group in server order.
 */
export const standingsView = (
  summary: GameSummary | undefined,
  seats: readonly InviteSeat[] | undefined,
  callerUserHash: string | undefined,
): StandingsView => {
  if (summary === undefined) return { kind: 'fallback' };
  return {
    kind: 'table',
    wonOnTurn: `Won on turn ${String(summary.turns)}`,
    rows: winnersFirst(summary.standings.map((standing) => rowOf(summary, standing, seats, callerUserHash))),
  };
};

/**
 * The view only when `displayedOver` is true (`victory.kind === 'over'`).
 * Otherwise the fallback, even if `summary` is present.
 */
export const standingsForHud = (
  displayedOver: boolean,
  summary: GameSummary | undefined,
  seats: readonly InviteSeat[] | undefined,
  callerUserHash: string | undefined,
): StandingsView =>
  displayedOver ? standingsView(summary, seats, callerUserHash) : { kind: 'fallback' };

/** False only for a table. The fallback keeps the local summary line. */
export const showMatchSummaryLine = (view: StandingsView): boolean => view.kind !== 'table';
