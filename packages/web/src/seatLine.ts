/**
 * The HUD seat line as items (P102 D6). Visible text stays `letter=kindLabel`.
 * Pure: no clock, no DOM, no I/O.
 *
 * @see docs/spec/lost-seat-standings/lost-seat-standings.md
 */

export interface SeatLineSeat {
  readonly letter: string;
  readonly kindLabel: string;
}

/**
 * `accessibleLabel` is present only on a lost item (`exactOptionalPropertyTypes`).
 * Absent means the key is missing, not `''`.
 */
export interface SeatLineItem {
  readonly letter: string;
  readonly text: string;
  readonly lost: boolean;
  readonly struck: boolean;
  readonly greyed: boolean;
  readonly accessibleLabel?: string;
}

/** Letter, space, U+2014, space, `eliminated`. */
const eliminatedName = (letter: string): string => `${letter} \u2014 eliminated`;

const living = (seat: SeatLineSeat): SeatLineItem => ({
  letter: seat.letter,
  text: `${seat.letter}=${seat.kindLabel}`,
  lost: false,
  struck: false,
  greyed: false,
});

const marked = (seat: SeatLineSeat): SeatLineItem => ({
  letter: seat.letter,
  text: `${seat.letter}=${seat.kindLabel}`,
  lost: true,
  struck: true,
  greyed: true,
  accessibleLabel: eliminatedName(seat.letter),
});

/** One item per roster seat, in `seats` order. A lost letter that is not listed adds no row. */
export const seatLineView = (
  seats: readonly SeatLineSeat[],
  lost: readonly string[],
): readonly SeatLineItem[] =>
  seats.map((seat) => (lost.includes(seat.letter) ? marked(seat) : living(seat)));
