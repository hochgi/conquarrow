/**
 * Library row identity helpers (P46) — vs-line and player letters.
 *
 * `PLAYER_SEAT_LABELS` is the spec spelling (`Player A` … `Player F`, same
 * letters as the board palette).
 *
 * @see docs/spec/online-library-identity/online-library-identity.md
 */

import type { LibrarySeat } from './online-port';

export const PLAYER_SEAT_LABELS = [
  'Player A',
  'Player B',
  'Player C',
  'Player D',
  'Player E',
  'Player F',
] as const;

export const playerLetterLabel = (index: number): string => PLAYER_SEAT_LABELS[index] ?? '';

/** Labels of chairs that are not `you`, joined with ` · `, in seat order. */
export const libraryVsLine = (seats: readonly LibrarySeat[]): string =>
  seats
    .filter((seat) => !seat.you)
    .map((seat) => seat.label)
    .join(' · ');
